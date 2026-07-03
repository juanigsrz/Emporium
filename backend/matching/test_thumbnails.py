"""board_game_thumbnail exposed on assignment / shipment / want-item / copy serializers."""
from matching.tests import MatchingTestBase
from trades.models import WantGroup, WantGroupItem


class ThumbnailFieldTests(MatchingTestBase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.game_brass.metadata = {"thumbnail": "https://img/brass.jpg"}
        cls.game_brass.save(update_fields=["metadata"])

    def test_trade_assignment_thumbnail(self):
        from matching.serializers import TradeAssignmentSerializer
        from matching.models import TradeAssignment, MatchRun
        run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        a = TradeAssignment.objects.create(
            match_run=run, event_listing=self.el_a1, giver=self.user_a,
            receiver=self.user_b, cycle_id=1,
        )
        data = TradeAssignmentSerializer(a).data
        self.assertEqual(data["board_game_thumbnail"], "https://img/brass.jpg")

    def test_shipment_thumbnail_empty_when_absent(self):
        from matching.serializers import ShipmentSerializer
        from matching.models import TradeAssignment, MatchRun, Shipment
        run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        a = TradeAssignment.objects.create(
            match_run=run, event_listing=self.el_b1, giver=self.user_b,
            receiver=self.user_a, cycle_id=1,
        )
        s = Shipment.objects.create(assignment=a)
        from rest_framework.test import APIRequestFactory
        req = APIRequestFactory().get("/")
        req.user = self.user_a
        data = ShipmentSerializer(s, context={"request": req}).data
        self.assertEqual(data["board_game_thumbnail"], "")

    def test_want_group_item_thumbnail_listing(self):
        from trades.serializers import WantGroupItemSerializer
        wg = WantGroup.objects.create(event=self.event, user=self.user_a, name="wg2")
        item = WantGroupItem.objects.create(
            want_group=wg, event_listing=self.el_a1,
        )
        data = WantGroupItemSerializer(item).data
        self.assertEqual(data["board_game_thumbnail"], "https://img/brass.jpg")

    def test_copy_thumbnail(self):
        from copies.serializers import CopySerializer
        data = CopySerializer(self.copy_a1).data
        self.assertEqual(data["board_game_thumbnail"], "https://img/brass.jpg")

    def test_offer_group_item_thumbnail(self):
        from trades.serializers import OfferGroupItemSerializer
        from trades.models import OfferGroup, OfferGroupItem
        og = OfferGroup.objects.create(event=self.event, user=self.user_a, name="og")
        ogi = OfferGroupItem.objects.create(offer_group=og, event_listing=self.el_a1)
        data = OfferGroupItemSerializer(ogi).data
        self.assertEqual(data["board_game_thumbnail"], "https://img/brass.jpg")
