"""Carryover: on archive, traded copies -> TRADED + fresh copies for receivers."""
from django.contrib.auth import get_user_model
from django.test import TestCase

from catalog.models import BoardGame
from copies.models import Copy
from events.models import Combo, ComboItem, EventListing, TradeEvent
from matching.models import MatchRun, TradeAssignment
from matching.services import apply_carryover

User = get_user_model()


class CarryoverTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.giver = User.objects.create_user("cogiver", "g@t.test", "pass1234")
        cls.receiver = User.objects.create_user("coreceiver", "r@t.test", "pass1234")
        cls.bg1 = BoardGame.objects.create(bgg_id=11001, name="Carry1")
        cls.bg2 = BoardGame.objects.create(bgg_id=11002, name="Carry2")

    def _event_with_done_run(self):
        event = TradeEvent.objects.create(name="Carry Ev", organizer=self.giver)
        run = MatchRun.objects.create(event=event, status=MatchRun.Status.DONE,
                                      algorithm="gurobi")
        return event, run

    def test_listing_assignment_flips_and_mints(self):
        event, run = self._event_with_done_run()
        copy = Copy.objects.create(owner=self.giver, board_game=self.bg1,
                                   condition="GOOD", language="EN")
        el = EventListing.objects.create(event=event, copy=copy)
        TradeAssignment.objects.create(
            match_run=run, event_listing=el, giver=self.giver,
            receiver=self.receiver, cycle_id=1,
        )
        apply_carryover(event)
        copy.refresh_from_db()
        self.assertEqual(copy.status, Copy.Status.TRADED)
        fresh = Copy.objects.filter(owner=self.receiver, board_game=self.bg1,
                                    status=Copy.Status.ACTIVE, import_source="carryover")
        self.assertEqual(fresh.count(), 1)
        self.assertEqual(fresh.first().condition, "GOOD")

    def test_combo_assignment_flips_all_members(self):
        event, run = self._event_with_done_run()
        c1 = Copy.objects.create(owner=self.giver, board_game=self.bg1)
        c2 = Copy.objects.create(owner=self.giver, board_game=self.bg2)
        el1 = EventListing.objects.create(event=event, copy=c1)
        el2 = EventListing.objects.create(event=event, copy=c2)
        combo = Combo.objects.create(event=event, owner=self.giver, name="cb")
        ComboItem.objects.create(combo=combo, event_listing=el1)
        ComboItem.objects.create(combo=combo, event_listing=el2)
        TradeAssignment.objects.create(
            match_run=run, combo=combo, giver=self.giver,
            receiver=self.receiver, cycle_id=1,
        )
        apply_carryover(event)
        c1.refresh_from_db(); c2.refresh_from_db()
        self.assertEqual(c1.status, Copy.Status.TRADED)
        self.assertEqual(c2.status, Copy.Status.TRADED)
        self.assertEqual(
            Copy.objects.filter(owner=self.receiver, status=Copy.Status.ACTIVE,
                                import_source="carryover").count(),
            2,
        )

    def test_idempotent(self):
        event, run = self._event_with_done_run()
        copy = Copy.objects.create(owner=self.giver, board_game=self.bg1)
        el = EventListing.objects.create(event=event, copy=copy)
        TradeAssignment.objects.create(
            match_run=run, event_listing=el, giver=self.giver,
            receiver=self.receiver, cycle_id=1,
        )
        apply_carryover(event)
        apply_carryover(event)  # second call must be a no-op
        self.assertEqual(
            Copy.objects.filter(owner=self.receiver, import_source="carryover").count(),
            1,
        )

    def test_no_done_run_is_noop(self):
        event = TradeEvent.objects.create(name="Empty Ev", organizer=self.giver)
        apply_carryover(event)  # no run -> no error, nothing minted
        self.assertEqual(Copy.objects.filter(import_source="carryover").count(), 0)
