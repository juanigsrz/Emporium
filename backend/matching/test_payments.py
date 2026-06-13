"""Settlement payments (item 5): model, derivation, endpoints."""
from matching.tests import MatchingTestBase
from matching.models import MatchRun, SettlementPayment


class PaymentModelTests(MatchingTestBase):
    def test_payment_defaults_pending(self):
        run = MatchRun.objects.create(event=self.event, status=MatchRun.Status.DONE)
        p = SettlementPayment.objects.create(
            match_run=run, from_user=self.user_b, to_user=self.user_a, amount="5.00"
        )
        self.assertEqual(p.status, SettlementPayment.Status.PENDING)
        self.assertEqual(p.note, "")
        self.assertIsNone(p.paid_at)
        self.assertIsNone(p.confirmed_at)
