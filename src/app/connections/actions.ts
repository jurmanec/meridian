"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { createConnection, updateConnection } from "@/db/store";

export type FormState = { error: string };

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export async function createConnectionAction(_state: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const sourceType = String(formData.get("sourceType") ?? "").trim();
  const tableName = String(formData.get("tableName") ?? "").trim();
  const region = String(formData.get("region") ?? "").trim();
  const endpoint = String(formData.get("endpoint") ?? "").trim();
  const accessKeyId = String(formData.get("accessKeyId") ?? "").trim();
  const secretAccessKey = String(formData.get("secretAccessKey") ?? "").trim();

  if (!name || !sourceType || !tableName || !region || !accessKeyId || !secretAccessKey) {
    return { error: "Name, source, table, region, and access key are required." };
  }

  try {
    await createConnection(getDb(), {
      name,
      sourceType,
      secretRef: "inline",
      secret: JSON.stringify({ accessKeyId, secretAccessKey }),
      config: { tableName, region, ...(endpoint ? { endpoint } : {}) },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "A connection with that name already exists." };
    }
    throw error;
  }

  redirect("/connections");
}

export async function updateConnectionAction(id: string, _state: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const sourceType = String(formData.get("sourceType") ?? "").trim();
  const tableName = String(formData.get("tableName") ?? "").trim();
  const region = String(formData.get("region") ?? "").trim();
  const endpoint = String(formData.get("endpoint") ?? "").trim();
  const accessKeyId = String(formData.get("accessKeyId") ?? "").trim();
  const secretAccessKey = String(formData.get("secretAccessKey") ?? "").trim();

  if (!name || !sourceType || !tableName || !region) {
    return { error: "Name, source, table, and region are required." };
  }
  if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
    return { error: "Enter both keys, or leave both blank to keep the stored key." };
  }

  try {
    await updateConnection(getDb(), id, {
      name,
      sourceType,
      config: { tableName, region, ...(endpoint ? { endpoint } : {}) },
      ...(accessKeyId ? { secret: JSON.stringify({ accessKeyId, secretAccessKey }) } : {}),
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "A connection with that name already exists." };
    }
    if (error instanceof Error && error.message === "Connection not found") {
      return { error: error.message };
    }
    throw error;
  }

  redirect("/connections");
}
