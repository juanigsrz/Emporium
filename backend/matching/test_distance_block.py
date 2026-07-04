"""
matching/test_distance_block.py

F4 — Distance-based owner exclusion in solver export.

A wisher with Profile.max_trade_distance_km=10 must NOT see copies owned by
users farther than 10 km away, and MUST still see copies from users within range.
"""

import json

from django.contrib.auth import get_user_model

from accounts.models import Profile
from matching import external_solver
from matching.tests import MatchingTestBase

User = get_user_model()


def _alice_take(event, alice_offer_code):
    """The take list of alice's wish (the one offering `alice_offer_code`)."""
    doc = json.loads(external_solver.build_wants(event))
    for w in doc["wishes"]:
        if alice_offer_code in w["give"]:
            return w["take"]
    raise AssertionError("no XTOY wish for alice's offering")


class DistanceBlockXToYTests(MatchingTestBase):
    """Export: far owner excluded, near owner included."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()

        Profile.objects.filter(user=cls.user_a).update(
            latitude=-34.6037,
            longitude=-58.3816,
            max_trade_distance_km=10,
        )
        Profile.objects.filter(user=cls.user_b).update(
            latitude=-34.6100,
            longitude=-58.3750,
        )
        Profile.objects.filter(user=cls.user_c).update(
            latitude=-31.4135,
            longitude=-64.1811,
        )

        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)

    def test_far_owner_excluded_from_take(self):
        take = _alice_take(self.event, self.copy_a1.listing_code)
        self.assertNotIn(
            self.copy_c2.listing_code, take,
            "carol's terra copy is ~700 km away and must be excluded from take list",
        )

    def test_near_owner_included_in_take(self):
        take = _alice_take(self.event, self.copy_a1.listing_code)
        self.assertIn(
            self.copy_b1.listing_code, take,
            "bob's terra copy is ~3 km away and must be included in take list",
        )


class DistanceBlockOwnerSideTests(MatchingTestBase):
    """An owner's OWN limit excludes a far wisher, even when the wisher has no
    limit of their own (symmetric enforcement)."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        # alice (owner of the wanted brass) limits herself to 10 km
        Profile.objects.filter(user=cls.user_a).update(
            latitude=-34.6037, longitude=-58.3816, max_trade_distance_km=10,
        )
        # carol is ~700 km away and sets NO limit of her own
        Profile.objects.filter(user=cls.user_c).update(
            latitude=-31.4135, longitude=-64.1811, max_trade_distance_km=None,
        )
        # bob is ~700 km from carol and sets no limit, so his copy stays reachable.
        Profile.objects.filter(user=cls.user_b).update(
            latitude=-34.6100, longitude=-58.3750, max_trade_distance_km=None,
        )
        # carol offers her gaia and wants BOTH alice's brass (alice limits to 10 km
        # -> must be dropped) and bob's terra (no limits either side -> kept).
        from trades.models import OfferGroup, OfferGroupItem, WantGroup, WantGroupItem, TradeWish
        og = OfferGroup.objects.create(event=cls.event, user=cls.user_c, name="og-c", max_give=1)
        OfferGroupItem.objects.create(offer_group=og, event_listing=cls.el_c2)  # carol's terra copy
        wg = WantGroup.objects.create(event=cls.event, user=cls.user_c, name="wg-c", min_receive=1)
        WantGroupItem.objects.create(want_group=wg, event_listing=cls.el_a1)  # alice brass (far)
        WantGroupItem.objects.create(want_group=wg, event_listing=cls.el_b1)  # bob terra (near-ish, no limits)
        cls.wish_c = TradeWish.objects.create(
            event=cls.event, user=cls.user_c, offer_group=og, want_group=wg, active=True,
        )

    def test_far_owner_limit_excludes_wisher(self):
        doc = json.loads(external_solver.build_wants(self.event))
        carol_wishes = [w for w in doc["wishes"] if self.copy_c2.listing_code in w["give"]]
        self.assertTrue(carol_wishes, "carol's wish should survive via bob's terra")
        for w in carol_wishes:
            self.assertNotIn(
                self.copy_a1.listing_code, w["take"],
                "alice's 10 km limit must exclude carol (~700 km) even though "
                "carol set no limit of her own",
            )
            self.assertIn(self.copy_b1.listing_code, w["take"])


class DistanceBlockNoLimitTests(MatchingTestBase):
    """Users without max_trade_distance_km see all copies (no regression)."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()

        # alice has coords but NO distance limit → should see everyone
        Profile.objects.filter(user=cls.user_a).update(
            latitude=-34.6037,
            longitude=-58.3816,
            max_trade_distance_km=None,
        )
        Profile.objects.filter(user=cls.user_b).update(
            latitude=-34.6100,
            longitude=-58.3750,
        )
        Profile.objects.filter(user=cls.user_c).update(
            latitude=-31.4135,
            longitude=-64.1811,
        )

        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)

    def test_no_limit_sees_all_terra_copies(self):
        take = _alice_take(self.event, self.copy_a1.listing_code)
        self.assertIn(self.copy_b1.listing_code, take)
        self.assertIn(self.copy_c2.listing_code, take)
