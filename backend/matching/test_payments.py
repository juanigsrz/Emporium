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


class PaymentEndpointBase(MatchingTestBase):
    def setUp(self):
        super().setUp()
        self.event.status = "SHIPPING"
        self.event.save(update_fields=["status"])
        self.run = MatchRun.objects.create(
            event=self.event, status=MatchRun.Status.DONE,
            result={"settlement": [
                {"from_user": "bob", "to_user": "alice", "amount": "5.00"},
            ]},
        )

    def _mine(self):
        return f"/api/events/{self.slug}/payments/"

    def _detail(self, pk):
        return f"/api/events/{self.slug}/payments/{pk}/"


class PaymentMineTests(PaymentEndpointBase):
    def test_payer_sees_pending_payment(self):
        self.client.force_authenticate(self.user_b)  # bob = payer
        r = self.client.get(self._mine())
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(len(r.data), 1)
        self.assertEqual(r.data[0]["my_role"], "payer")
        self.assertEqual(r.data[0]["status"], "PENDING")

    def test_payee_sees_payment(self):
        self.client.force_authenticate(self.user_a)  # alice = payee
        r = self.client.get(self._mine())
        self.assertEqual(r.data[0]["my_role"], "payee")

    def test_uninvolved_user_sees_none(self):
        self.client.force_authenticate(self.user_c)  # carol
        r = self.client.get(self._mine())
        self.assertEqual(r.data, [])


class PaymentPatchTests(PaymentEndpointBase):
    def _payment(self):
        ensure_payments(self.run)
        return SettlementPayment.objects.get(match_run=self.run)

    def test_payer_marks_paid_with_note(self):
        p = self._payment()
        self.client.force_authenticate(self.user_b)
        r = self.client.patch(self._detail(p.id),
                              {"status": "PAID", "note": "venmo #42"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        p.refresh_from_db()
        self.assertEqual(p.status, "PAID")
        self.assertEqual(p.note, "venmo #42")
        self.assertIsNotNone(p.paid_at)

    def test_payee_cannot_mark_paid(self):
        p = self._payment()
        self.client.force_authenticate(self.user_a)
        self.assertEqual(
            self.client.patch(self._detail(p.id), {"status": "PAID"}, format="json").status_code,
            403,
        )

    def test_payee_confirms_after_paid(self):
        p = self._payment()
        p.status = "PAID"; p.save(update_fields=["status"])
        self.client.force_authenticate(self.user_a)
        r = self.client.patch(self._detail(p.id), {"status": "CONFIRMED"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        p.refresh_from_db()
        self.assertEqual(p.status, "CONFIRMED")
        self.assertIsNotNone(p.confirmed_at)

    def test_confirm_requires_paid_first(self):
        p = self._payment()
        self.client.force_authenticate(self.user_a)
        self.assertEqual(
            self.client.patch(self._detail(p.id), {"status": "CONFIRMED"}, format="json").status_code,
            400,
        )

    def test_payer_cannot_confirm(self):
        p = self._payment()
        p.status = "PAID"; p.save(update_fields=["status"])
        self.client.force_authenticate(self.user_b)
        self.assertEqual(
            self.client.patch(self._detail(p.id), {"status": "CONFIRMED"}, format="json").status_code,
            403,
        )

    def test_patch_blocked_when_not_shipping(self):
        p = self._payment()
        self.event.status = "ARCHIVED"; self.event.save(update_fields=["status"])
        self.client.force_authenticate(self.user_b)
        self.assertEqual(
            self.client.patch(self._detail(p.id), {"status": "PAID"}, format="json").status_code,
            403,
        )


class PaymentOverviewTests(PaymentEndpointBase):
    def _overview(self):
        return f"/api/events/{self.slug}/payments/overview/"

    def _summary(self):
        return f"/api/events/{self.slug}/payments/overview/summary/"

    def test_overview_organizer_only(self):
        self.client.force_authenticate(self.user_b)  # not organizer
        self.assertEqual(self.client.get(self._overview()).status_code, 403)

    def test_overview_paginated(self):
        self.client.force_authenticate(self.user_a)  # organizer
        r = self.client.get(self._overview())
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["count"], 1)
        self.assertEqual(len(r.data["results"]), 1)

    def test_overview_status_filter(self):
        self.client.force_authenticate(self.user_a)
        self.client.get(self._overview())  # create payment rows
        SettlementPayment.objects.filter(match_run=self.run).update(status="PAID")
        self.assertEqual(self.client.get(self._overview() + "?status=PAID").data["count"], 1)
        self.assertEqual(self.client.get(self._overview() + "?status=PENDING").data["count"], 0)

    def test_summary_counts_and_rollup(self):
        self.client.force_authenticate(self.user_a)
        self.client.get(self._overview())  # create payment rows
        r = self.client.get(self._summary())
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["counts"].get("PENDING"), 1)
        bob = next(u for u in r.data["users"] if u["username"] == "bob")
        self.assertEqual(bob["owe_total"], 1)
        self.assertEqual(bob["owe_paid"], 0)
        alice = next(u for u in r.data["users"] if u["username"] == "alice")
        self.assertEqual(alice["due_total"], 1)
