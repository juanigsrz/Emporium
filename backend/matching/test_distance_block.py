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

    def _alice_take_line(self, text):
        a1_code = self.copy_a1.listing_code
        for line in text.splitlines():
            if a1_code in line.split("->")[0]:
                return line.split("->")[1]
        self.fail("no XTOY line for alice's offering")

    def test_no_limit_sees_all_terra_copies(self):
        text = external_solver.build_wants(self.event)
        take = self._alice_take_line(text)
        self.assertIn(self.copy_b1.listing_code, take)
        self.assertIn(self.copy_c2.listing_code, take)
