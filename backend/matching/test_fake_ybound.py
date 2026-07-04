"""FakeMatcher must not give an item on behalf of a wish it can't satisfy:
a wish requiring Y>1 stays unmatched and gives nothing (the greedy placeholder
only awards one received item per cycle). It also must never award the same
physical listing to two receivers."""
from matching.fake_matcher import FakeMatcher
from matching.models import MatchRun, TradeAssignment
from matching.tests import MatchingTestBase


class FakeMatcherYBoundTests(MatchingTestBase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        # alice insists on receiving AT LEAST 2 items for her brass copy
        cls.wish_a = cls._make_wish(
            cls.user_a, cls.el_a1, want_game=cls.game_terra, min_receive=2
        )
        # bob offers his terra, wants brass
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

    def test_unsatisfiable_y_wish_gives_nothing(self):
        run = MatchRun.objects.create(event=self.event)
        result, _summary, _log = FakeMatcher(run).run()

        received_by_alice = TradeAssignment.objects.filter(
            match_run=run, receiver=self.user_a
        ).count()
        gave_alice = TradeAssignment.objects.filter(
            match_run=run, giver=self.user_a
        ).count()

        self.assertLess(received_by_alice, 2)
        self.assertEqual(
            gave_alice, 0,
            "alice gave an item despite her Y=2 wish being unsatisfiable",
        )
        self.assertIn(self.wish_a.id, {u["wish_id"] for u in result["unmatched"]})


class FakeMatcherNoDoubleAllocTests(MatchingTestBase):
    def test_each_listing_moves_at_most_once(self):
        # Two wishers both want alice's single brass listing; only one can get it.
        self._make_wish(self.user_a, self.el_a1, want_game=self.game_terra)
        self._make_wish(self.user_b, self.el_b1, want_listing=self.el_a1)
        self._make_wish(self.user_c, self.el_c2, want_listing=self.el_a1)

        run = MatchRun.objects.create(event=self.event)
        FakeMatcher(run).run()

        moves = list(
            TradeAssignment.objects.filter(
                match_run=run, event_listing=self.el_a1
            ).values_list("id", flat=True)
        )
        self.assertLessEqual(len(moves), 1, "alice's brass moved to more than one receiver")
