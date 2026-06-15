"""
events/test_event_cycle_qa.py

Full end-to-end QA of the trade-event lifecycle, driven through the real DRF
HTTP endpoints (serializers, views, permissions) — not the ORM. Walks an event
from DRAFT → ARCHIVED and exercises the features added on top:

  - money trading, two-sided: buyer max P (resolve_bid) + seller min Q
    (resolve_ask), event cap + per-user budget;
  - duplicate-protection flag on want groups;
  - canonical board_game_id on want items (FE grouping);
  - solver wants-export money directives (user/item/bid) + dupcap directives;
  - matching run (offline FakeMatcher) → assignments → result/mine;
  - lifecycle transitions + organizer-only / invalid-transition guards.

This is the authoritative "does the whole cycle still work" check.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import BoardGame
from catalog.tasks import import_boardgames_csv
from copies.models import Copy
from matching.models import TradeAssignment

# Reuse the tiny 4-game CSV fixture helpers from the trades suite.
from trades.tests import SAMPLE_ROWS, _make_csv

User = get_user_model()

EVENTS = "/api/events/"


def ev(slug):                 return f"{EVENTS}{slug}/"
def transition(slug):         return f"{EVENTS}{slug}/transition/"
def join(slug):               return f"{EVENTS}{slug}/join/"
def listings(slug):           return f"{EVENTS}{slug}/listings/"
def offer_groups(slug):       return f"{EVENTS}{slug}/offer-groups/"
def want_groups(slug):        return f"{EVENTS}{slug}/want-groups/"
def wishes(slug):             return f"{EVENTS}{slug}/wishes/"
def wants_export(slug):       return f"{EVENTS}{slug}/wants-export/"
def matches(slug):            return f"{EVENTS}{slug}/matches/"
def match_detail(slug, rid):  return f"{EVENTS}{slug}/matches/{rid}/"
def match_result(slug, rid):  return f"{EVENTS}{slug}/matches/{rid}/result/"
def match_mine(slug, rid):    return f"{EVENTS}{slug}/matches/{rid}/mine/"


class EventCycleQA(APITestCase):
    """One class, shared users/copies; each test rolls back independently."""

    @classmethod
    def setUpTestData(cls):
        path = _make_csv(SAMPLE_ROWS)
        import_boardgames_csv(path=path)
        import os; os.unlink(path)

        cls.organizer = User.objects.create_user("qa_org", "org@qa.test", "pass1234")
        cls.t1 = User.objects.create_user("qa_t1", "t1@qa.test", "pass1234")
        cls.t2 = User.objects.create_user("qa_t2", "t2@qa.test", "pass1234")
        cls.t3 = User.objects.create_user("qa_t3", "t3@qa.test", "pass1234")

        cls.brass = BoardGame.objects.get(bgg_id=224517)
        cls.ark   = BoardGame.objects.get(bgg_id=342942)
        cls.terra = BoardGame.objects.get(bgg_id=167791)
        cls.gaia  = BoardGame.objects.get(bgg_id=220308)

        # t1: brass, ark   t2: terra, gaia   t3: brass(2)
        cls.c1_brass = Copy.objects.create(owner=cls.t1, board_game=cls.brass)
        cls.c1_ark   = Copy.objects.create(owner=cls.t1, board_game=cls.ark)
        cls.c2_terra = Copy.objects.create(owner=cls.t2, board_game=cls.terra)
        cls.c2_gaia  = Copy.objects.create(owner=cls.t2, board_game=cls.gaia)
        cls.c3_brass = Copy.objects.create(owner=cls.t3, board_game=cls.brass)

    # ------------------------------------------------------------------ helpers

    def _create_event(self, **money):
        self.client.force_authenticate(self.organizer)
        body = {"name": "QA Cycle Event", "description": "qa"}
        body.update(money)
        resp = self.client.post(EVENTS, body, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        return resp.data["slug"]

    def _transition(self, slug, to):
        self.client.force_authenticate(self.organizer)
        resp = self.client.post(transition(slug), {"to": to}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["status"], to)

    def _add_listing(self, slug, user, copy):
        self.client.force_authenticate(user)
        resp = self.client.post(listings(slug), {"copy": copy.id}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        return resp.data["id"]

    def _build_wish(self, slug, user, offer_listing_id, want_game, *, dup=True):
        """offer group (max_give=1) + want group (dup) + wish — the per-listing
        trio the normal want builder creates."""
        self.client.force_authenticate(user)

        og_body = {"name": f"og-{offer_listing_id}", "max_give": 1,
                   "item_listing_ids": [offer_listing_id]}
        og = self.client.post(offer_groups(slug), og_body, format="json")
        self.assertEqual(og.status_code, status.HTTP_201_CREATED, og.data)

        from events.models import EventListing
        items = [
            {"event_listing": el_id}
            for el_id in EventListing.objects.filter(
                event__slug=slug, copy__board_game=want_game
            ).exclude(copy__owner=user).values_list("id", flat=True)
        ]
        wg = self.client.post(want_groups(slug), {
            "name": f"wg-{offer_listing_id}", "min_receive": 1,
            "duplicate_protection": dup, "items": items,
        }, format="json")
        self.assertEqual(wg.status_code, status.HTTP_201_CREATED, wg.data)

        wish = self.client.post(wishes(slug), {
            "offer_group": og.data["id"], "want_group": wg.data["id"], "active": True,
        }, format="json")
        self.assertEqual(wish.status_code, status.HTTP_201_CREATED, wish.data)
        return og.data, wg.data, wish.data

    # ------------------------------------------------------------------ the walk

    def test_full_event_cycle(self):
        # 1. CREATE (money on, cap 50) -------------------------------------
        slug = self._create_event(money_enabled=True, max_money_per_user="50.00")
        self.client.force_authenticate(self.organizer)
        e = self.client.get(ev(slug)).data
        self.assertEqual(e["status"], "DRAFT")
        self.assertTrue(e["money_enabled"])
        self.assertEqual(e["max_money_per_user"], "50.00")

        # invalid transition rejected (DRAFT -> MATCHING)
        bad = self.client.post(transition(slug), {"to": "MATCHING"}, format="json")
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)

        # 2. OPEN SUBMISSIONS ---------------------------------------------
        self._transition(slug, "SUBMISSIONS_OPEN")

        # non-organizer cannot transition
        self.client.force_authenticate(self.t1)
        forbidden = self.client.post(transition(slug), {"to": "WANTLIST_OPEN"}, format="json")
        self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)

        # 3. JOIN + budgets (capped) --------------------------------------
        for u, budget in [(self.t1, "30"), (self.t2, "40"), (self.t3, "15")]:
            self.client.force_authenticate(u)
            r = self.client.post(join(slug), {"max_spend": budget}, format="json")
            self.assertIn(r.status_code, (status.HTTP_200_OK, status.HTTP_201_CREATED), r.data)
            self.assertEqual(Decimal(r.data["max_spend"]), Decimal(budget))

        # budget over cap rejected
        self.client.force_authenticate(self.t1)
        over = self.client.post(join(slug), {"max_spend": "999"}, format="json")
        self.assertEqual(over.status_code, status.HTTP_400_BAD_REQUEST)

        # 4. SUBMIT LISTINGS ----------------------------------------------
        l1_brass = self._add_listing(slug, self.t1, self.c1_brass)
        self._add_listing(slug, self.t1, self.c1_ark)
        l2_terra = self._add_listing(slug, self.t2, self.c2_terra)
        self._add_listing(slug, self.t2, self.c2_gaia)
        l3_brass = self._add_listing(slug, self.t3, self.c3_brass)

        self.client.force_authenticate(self.organizer)
        all_listings = self.client.get(listings(slug)).data
        self.assertEqual(all_listings["count"], 5)

        # match run blocked before MATCHING status
        early = self.client.post(matches(slug), format="json")
        self.assertEqual(early.status_code, status.HTTP_400_BAD_REQUEST)

        # 5. OPEN WANT LISTS ----------------------------------------------
        self._transition(slug, "WANTLIST_OPEN")

        # 6. BUILD WANT LISTS ---------------------------------------------
        # reciprocal pair → guaranteed 2-cycle. money: t1 pays up to 20 for terra,
        # t2 will accept >= 10 to give terra (P >= Q feasible).
        self._build_wish(slug, self.t1, l1_brass, self.terra)
        self._build_wish(slug, self.t2, l2_terra, self.brass)
        self._build_wish(slug, self.t3, l3_brass, self.gaia)

        # read-back: want group fields surfaced for the FE
        self.client.force_authenticate(self.t1)
        wg_list = self.client.get(want_groups(slug)).data["results"]
        self.assertEqual(len(wg_list), 1)
        wg = wg_list[0]
        self.assertTrue(wg["duplicate_protection"])
        it = wg["items"][0]
        self.assertEqual(it["board_game_id"], self.terra.bgg_id)   # canonical id present

        # 7. WANTS EXPORT placeholder header round-trips -------------------
        # Set prices via the new resolution model (resolve_ask/resolve_bid):
        # t1 buy bid for terra via UserGamePrice, t2 sell ask via EventListing.sell_price.
        from events.models import EventListing, TradeEvent
        from trades.models import UserGamePrice
        event_obj = TradeEvent.objects.get(slug=slug)
        UserGamePrice.objects.create(
            user=self.t1, event=event_obj, board_game=self.terra, price=20
        )
        EventListing.objects.filter(id=l2_terra).update(sell_price=10)

        self.client.force_authenticate(self.organizer)
        exp = self.client.get(wants_export(slug))
        self.assertEqual(exp.status_code, status.HTTP_200_OK)
        text = exp.content.decode()
        self.assertIn(f"user {self.t1.username} budget 3000", text)
        # dup protection no longer emits a tag; t1's single terra copy passes
        # through with no dummy node (t2's brass wish with 2 copies will get one).
        self.assertNotIn("DUP-PROTECT", text)
        self.assertNotIn("__DUMMY", text)
        # terra has a single active copy (c2_terra) -> not capped.
        self.assertFalse(
            any(l.startswith("dupcap") and self.c2_terra.listing_code in l
                for l in text.splitlines()),
            "single-copy terra should not be capped",
        )
        # brass has two copies (t1, t3) and t2 wants it -> a dupcap for t2.
        self.assertTrue(
            any(l.startswith(f"dupcap {self.t2.username} ")
                for l in text.splitlines()),
            "two-copy brass want should emit a dupcap",
        )
        self.assertIn(f"bid {self.t1.username} {self.c2_terra.listing_code} 2000", text)
        self.assertIn(f"item {self.c2_terra.listing_code} owner {self.t2.username} ask 1000", text)
        # body still valid NforM: at least one "user : (NforM) give -> take" line
        self.assertTrue(any(" : " in l for l in text.splitlines() if not l.startswith("#")))

        # 8. RUN MATCHING -------------------------------------------------
        self._transition(slug, "MATCHING")

        # non-organizer cannot trigger
        self.client.force_authenticate(self.t1)
        self.assertEqual(self.client.post(matches(slug), format="json").status_code,
                         status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(self.organizer)
        run_resp = self.client.post(matches(slug), format="json")
        self.assertEqual(run_resp.status_code, status.HTTP_201_CREATED, run_resp.data)
        rid = run_resp.data["id"]

        detail = self.client.get(match_detail(slug, rid)).data
        self.assertEqual(detail["status"], "DONE")          # eager (CELERY_TASK_ALWAYS_EAGER)
        self.assertEqual(detail["algorithm"], "fake")

        result = self.client.get(match_result(slug, rid)).data
        for key in ("algorithm", "generated_at", "cycles", "unmatched", "stats"):
            self.assertIn(key, result)

        # the reciprocal pair must produce assignments
        n_assign = TradeAssignment.objects.filter(match_run_id=rid).count()
        self.assertGreater(n_assign, 0, "FakeMatcher produced no trades for reciprocal wants")

        # a participant in the cycle sees their own assignments
        self.client.force_authenticate(self.t1)
        mine = self.client.get(match_mine(slug, rid)).data
        mine_rows = mine["results"] if isinstance(mine, dict) and "results" in mine else mine
        self.assertGreaterEqual(len(mine_rows), 1)
        row = mine_rows[0]
        for key in ("listing_code", "board_game_name", "giver_username", "receiver_username"):
            self.assertIn(key, row)
        self.assertTrue(
            self.t1.username in (row["giver_username"], row["receiver_username"])
        )

        # 9. WALK TO ARCHIVED ---------------------------------------------
        for to in ["MATCH_REVIEW", "FINALIZATION", "SHIPPING", "ARCHIVED"]:
            self._transition(slug, to)

        self.client.force_authenticate(self.organizer)
        final = self.client.get(ev(slug)).data
        self.assertEqual(final["status"], "ARCHIVED")
        self.assertEqual(final["allowed_transitions"], [])     # terminal

        # no transition out of ARCHIVED
        stuck = self.client.post(transition(slug), {"to": "SHIPPING"}, format="json")
        self.assertEqual(stuck.status_code, status.HTTP_400_BAD_REQUEST)

    # ------------------------------------------------------------------ focused

    def test_money_disabled_event_ignores_budget_and_money_export(self):
        slug = self._create_event()  # money off
        self._transition(slug, "SUBMISSIONS_OPEN")

        self.client.force_authenticate(self.t1)
        r = self.client.post(join(slug), {"max_spend": "20"}, format="json")
        self.assertIn(r.status_code, (status.HTTP_200_OK, status.HTTP_201_CREATED))
        self.assertEqual(Decimal(r.data["max_spend"]), Decimal("0"))   # ignored

        l1 = self._add_listing(slug, self.t1, self.c1_brass)
        self._transition(slug, "WANTLIST_OPEN")
        self._build_wish(slug, self.t1, l1, self.terra, dup=False)

        self.client.force_authenticate(self.organizer)
        text = self.client.get(wants_export(slug)).content.decode()
        self.assertNotIn("#! MONEY-ENABLED", text)
        self.assertNotIn("#! MONEY-WANT", text)
        self.assertNotIn("DUP-PROTECT", text)   # dup=False, money off
