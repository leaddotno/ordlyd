/**
 * Tynn adapter mellom Vercels Node-funksjoner og rene handlerfunksjoner.
 *
 * Handlerne tar en avkodet forespørsel og returnerer et HttpResponse, så
 * de kan testes uten HTTP-lag i det hele tatt.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { CORS_HEADERS, type HttpResponse } from "./runtime.js";

export interface DecodedRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
  ip: string;
}

export type Handler = (req: DecodedRequest) => Promise<HttpResponse>;

function parseBody(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

/**
 * Pakker en handler som en Vercel-funksjon: håndterer preflight,
 * metodesjekk og at uventede feil aldri lekker stakksporet ut.
 */
export function vercelHandler(allowedMethod: "GET" | "POST", handler: Handler) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (req.method !== allowedMethod) {
      res.status(405).json({ feil: "metode-ikke-tillatt" });
      return;
    }

    try {
      const forwarded = req.headers["x-forwarded-for"];
      const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() || "0.0.0.0";
      const result = await handler({
        method: req.method ?? allowedMethod,
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: parseBody(req.body),
        ip,
      });
      for (const [k, v] of Object.entries(result.headers ?? {})) res.setHeader(k, v);
      res.status(result.status).json(result.body);
    } catch (err) {
      // Detaljer til serverloggen, aldri til klienten.
      console.error("[lisensserver]", err);
      res.status(500).json({ feil: "serverfeil" });
    }
  };
}

export function requireString(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
