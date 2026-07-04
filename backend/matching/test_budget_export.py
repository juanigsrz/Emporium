"""Budget export (external_solver): the per-user money cap must actually bind.

A participant who never set max_spend (default 0) must NOT be exported as
unconstrained; and a stale max_spend above a lowered event cap must be clamped.
"""
import json

from events.models import EventParticipation
from matching import external_solver
from matching.tests import MatchingTestBase


def _budgets(event):
    doc = json.loads(external_solver.build_wants(event))
    return {b["user"]: b["budget"] for b in doc["budgets"]}


class BudgetExportTests(MatchingTestBase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.wish_a = cls._make_wish(cls.user_a, cls.el_a1, want_game=cls.game_terra)
        cls.wish_b = cls._make_wish(cls.user_b, cls.el_b1, want_game=cls.game_brass)

    def setUp(self):
        super().setUp()
        self.event.money_enabled = True
        self.event.max_money_per_user = 100
        self.event.save(update_fields=["money_enabled", "max_money_per_user"])

    def test_participant_without_spend_is_capped_not_unconstrained(self):
        # alice joins but never sets a spend (max_spend stays 0)
        EventParticipation.objects.create(event=self.event, user=self.user_a)
        budgets = _budgets(self.event)
        self.assertIn(self.user_a.username, budgets,
                      "participant with no spend must still get a budget entry")
        self.assertEqual(budgets[self.user_a.username], 0)

    def test_stale_spend_clamped_to_lowered_cap(self):
        # alice set 80, organizer later lowers the cap to 30
        EventParticipation.objects.create(
            event=self.event, user=self.user_a, max_spend=80
        )
        self.event.max_money_per_user = 30
        self.event.save(update_fields=["max_money_per_user"])
        budgets = _budgets(self.event)
        self.assertEqual(budgets[self.user_a.username], 3000)  # 30.00 -> cents

    def test_spend_within_cap_preserved(self):
        EventParticipation.objects.create(
            event=self.event, user=self.user_a, max_spend=40
        )
        self.assertEqual(_budgets(self.event)[self.user_a.username], 4000)
