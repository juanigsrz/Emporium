"""
matching/test_distance_block.py

F4 — Distance-based owner exclusion in solver export.

A wisher with Profile.max_trade_distance_km=10 must NOT see copies owned by
users farther than 10 km away, and MUST still see copies from users within range.
"""

from django.contrib.auth import get_user_model

from accounts.models import Profile
from matching import external_solver
from matching.tests import MatchingTestBase

User = get_user_model()


class DistanceBlockOneToOneTests(MatchingTestBase):
    """ONETOONE export: far owner excluded, near owner included."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()

        # alice (user_a) wants terra; she is the wisher under test.
        # Set her location in Buenos Aires and a 10 km limit.
        Profile.objects.filter(user=cls.user_a).update(
            latitude=-34.6037,
            longitude=-58.3816,
            max_trade_distance_km=10,
        )

        # "near" owner: bob (user_b) — in the same city, ~3 km from alice.
        Profile.objects.filter(user=cls.user_b).update(
            latitude=-34.6100,
            longitude=-58.3750,
        )

        # "far" owner: carol (user_c) — Córdoba, ~700 km away.
        Profile.objects.filter(user=cls.user_c).update(
            latitude=-31.4135,
            longitude=-64.1811,
        )

        # alice offers brass (el_a1), wants terra.
        # bob owns terra (copy_b1 / el_b1) — within range → should appear.
        # carol owns terra (copy_c2 / el_c2) — out of range → must NOT appear.
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)

    def _line_for(self, text, code):
        for line in text.splitlines():
            if f" {code} :" in line:
                return line
        self.fail(f"no OLWLG line for listing code {code!r}")

    def test_far_owner_excluded_from_wishlist(self):
        text = external_solver.build_wants(self.event)
        line = self._line_for(text, self.copy_a1.listing_code)
        wishlist = line.split(":", 1)[1]
        self.assertNotIn(
            self.copy_c2.listing_code, wishlist,
            "carol's terra copy is ~700 km away and must be excluded",
        )

    def test_near_owner_included_in_wishlist(self):
        text = external_solver.build_wants(self.event)
        line = self._line_for(text, self.copy_a1.listing_code)
        wishlist = line.split(":", 1)[1]
        self.assertIn(
            self.copy_b1.listing_code, wishlist,
            "bob's terra copy is ~3 km away and must be included",
        )


class DistanceBlockXToYTests(MatchingTestBase):
    """XTOY export: far owner excluded, near owner included."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()

        from events.models import TradeEvent
        cls.event.matching_mode = TradeEvent.MatchingMode.XTOY
        cls.event.save(update_fields=["matching_mode"])

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

    def _alice_take_line(self, text):
        """Return the take portion of alice's wish line."""
        a1_code = self.copy_a1.listing_code
        for line in text.splitlines():
            if a1_code in line.split("->")[0]:
                return line.split("->")[1]
        self.fail("no XTOY line for alice's offering")

    def test_far_owner_excluded_from_take(self):
        text = external_solver.build_wants(self.event)
        take = self._alice_take_line(text)
        self.assertNotIn(
            self.copy_c2.listing_code, take,
            "carol's terra copy is ~700 km away and must be excluded from take list",
        )

    def test_near_owner_included_in_take(self):
        text = external_solver.build_wants(self.event)
        take = self._alice_take_line(text)
        self.assertIn(
            self.copy_b1.listing_code, take,
            "bob's terra copy is ~3 km away and must be included in take list",
        )


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

    def _line_for(self, text, code):
        for line in text.splitlines():
            if f" {code} :" in line:
                return line
        self.fail(f"no OLWLG line for {code!r}")

    def test_no_limit_sees_all_terra_copies(self):
        text = external_solver.build_wants(self.event)
        line = self._line_for(text, self.copy_a1.listing_code)
        wishlist = line.split(":", 1)[1]
        self.assertIn(self.copy_b1.listing_code, wishlist)
        self.assertIn(self.copy_c2.listing_code, wishlist)
