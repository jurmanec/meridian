"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/lib/fields";
import { createConnectionAction, updateConnectionAction, type FormState } from "./actions";

const initialState: FormState = { error: "" };

export type ConnectionFormConnection = {
  id: string;
  name: string;
  sourceType: string;
  tableName: string;
  region: string;
  endpoint: string;
};

export function ConnectionForm({ connection }: { connection?: ConnectionFormConnection }) {
  const submit = useMemo(() => (connection ? updateConnectionAction.bind(null, connection.id) : createConnectionAction), [connection?.id]);
  const [state, action, pending] = useActionState(submit, initialState);
  const [name, setName] = useState(connection?.name ?? "");
  const [tableName, setTableName] = useState(connection?.tableName ?? "");
  const [region, setRegion] = useState(connection?.region ?? "us-east-1");
  const [endpoint, setEndpoint] = useState(connection?.endpoint ?? "");

  return (
    <form action={action} className="flex max-w-lg flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Name</span>
        <input className={fieldClass} name="name" required autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Source</span>
        <select className={fieldClass} name="sourceType" defaultValue={connection?.sourceType ?? "dynamodb"}>
          <option value="dynamodb">DynamoDB</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Table</span>
        <input className={fieldClass} name="tableName" required autoComplete="off" value={tableName} onChange={(event) => setTableName(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Region</span>
        <input className={fieldClass} name="region" required autoComplete="off" value={region} onChange={(event) => setRegion(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Endpoint</span>
        <input className={fieldClass} name="endpoint" autoComplete="off" placeholder="Optional" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
        <span className="text-sm text-muted-foreground">Leave this empty for the default DynamoDB endpoint.</span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Access key id</span>
        <input className={fieldClass} name="accessKeyId" required={!connection} autoComplete="off" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Secret access key</span>
        <input className={fieldClass} name="secretAccessKey" type="password" required={!connection} autoComplete="off" />
        {connection ? <span className="text-sm text-muted-foreground">Leave both keys blank to keep the stored key.</span> : null}
      </label>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : connection ? "Save changes" : "Save connection"}
      </Button>
    </form>
  );
}
