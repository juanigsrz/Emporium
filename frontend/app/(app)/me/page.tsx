"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { me as meApi } from "@/lib/api/resources";
import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle, Badge } from "@/components/ui/primitives";
import { FormField, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

export default function ProfilePage() {
  const { me, refresh } = useAuth();
  const { toast } = useToast();
  const [bggUsername, setBggUsername] = useState(me?.bgg_username ?? "");
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const errMsg = (e: unknown) =>
    e instanceof ApiError ? e.message : "Something went wrong.";

  const link = useMutation({
    mutationFn: () => meApi.bggLink(bggUsername),
    onSuccess: async () => {
      await refresh();
      toast("BGG account linked. Verify it next.", "success");
    },
    onError: (e) => toast(errMsg(e), "error"),
  });

  const verify = useMutation({
    mutationFn: () => meApi.bggVerify(),
    onSuccess: async () => {
      await refresh();
      toast("BGG account verified.", "success");
    },
    onError: (e) => toast(errMsg(e), "error"),
  });

  const doImport = useMutation({
    mutationFn: () => meApi.bggImport(),
    onSuccess: (res) => {
      setImportMsg(
        res.created != null
          ? `${res.detail} ${res.created} draft copies created.`
          : res.detail,
      );
      toast("Collection import started.", "success");
    },
    onError: (e) => toast(errMsg(e), "error"),
  });

  if (!me) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Profile</h1>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <Row label="Username" value={me.username} />
          <Row label="Email" value={me.email} />
          <Row
            label="Role"
            value={me.is_organizer ? "Organizer" : "Member"}
          />
          <Row label="Default region" value={me.default_region || "—"} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>BoardGameGeek</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Status:</span>
            {me.bgg_username ? (
              me.bgg_verified ? (
                <Badge tone="success">Verified: {me.bgg_username}</Badge>
              ) : (
                <Badge tone="warning">Linked, unverified: {me.bgg_username}</Badge>
              )
            ) : (
              <Badge tone="neutral">Not linked</Badge>
            )}
          </div>

          <FormField label="BGG username" htmlFor="bgg">
            <Input
              id="bgg"
              value={bggUsername}
              onChange={(e) => setBggUsername(e.target.value)}
              placeholder="your_bgg_handle"
            />
          </FormField>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!bggUsername || link.isPending}
              onClick={() => link.mutate()}
            >
              {me.bgg_username ? "Update link" : "Link account"}
            </Button>
            <Button
              variant="secondary"
              disabled={!me.bgg_username || me.bgg_verified || verify.isPending}
              onClick={() => verify.mutate()}
            >
              Verify
            </Button>
            <Button
              disabled={!me.bgg_verified || doImport.isPending}
              onClick={() => doImport.mutate()}
            >
              {doImport.isPending ? "Importing…" : "Import collection"}
            </Button>
          </div>
          {importMsg && (
            <p className="rounded-md bg-slate-50 p-2 text-sm text-slate-600">
              {importMsg}
            </p>
          )}
          <p className="text-xs text-slate-500">
            Importing creates draft copies from your owned BGG collection that you
            can then edit under “My copies”.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-50 py-1">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}
