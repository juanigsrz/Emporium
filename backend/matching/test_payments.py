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


from matching.services import ensure_payments


class EnsurePaymentsTests(MatchingTestBase):
    def _run_with_settlement(self):
        return MatchRun.objects.create(
            event=self.event, status=MatchRun.Status.DONE,
            result={"settlement": [
                {"from_user": "bob", "to_user": "alice", "amount": "5.00"},
            ]},
        )

    def test_creates_and_is_idempotent(self):
        run = self._run_with_settlement()
        ensure_payments(run)
        ensure_payments(run)
        self.assertEqual(
            SettlementPayment.objects.filter(match_run=run).count(), 1
        )
        p = SettlementPayment.objects.get(match_run=run)
        self.assertEqual(p.from_user, self.user_b)
        self.assertEqual(p.to_user, self.user_a)
        self.assertEqual(str(p.amount), "5.00")

    def test_noop_without_settlement(self):
        run = MatchRun.objects.create(
            event=self.event, status=MatchRun.Status.DONE, result={}
        )
        ensure_payments(run)
        self.assertEqual(SettlementPayment.objects.filter(match_run=run).count(), 0)


class PaymentSerializerTests(MatchingTestBase):
    def test_serializer_fields(self):
        from matching.serializers import SettlementPaymentSerializer
        fields = set(SettlementPaymentSerializer().fields)
        self.assertTrue({
            "id", "status", "amount", "note", "from_username",
            "to_username", "my_role", "paid_at", "confirmed_at",
        }.issubset(fields))
