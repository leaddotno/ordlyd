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
  query: Record<string, string>;
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
export interface HandlerValg {
  /**
   * Åpen CORS. Standard er PÅ, slik at alle eksisterende endepunkter er
   * uendret — utvidelsen kaller fra en chrome-extension://-opprinnelse
   * som skifter mellom bygg, og MÅ ha `*`.
   *
   * Admin-endepunktene setter dette til false. De er samme opprinnelse
   * som panelet og trenger ingen CORS-hoder i det hele tatt; uten dem
   * kan en fremmed side verken lese svar eller utløse handlinger.
   * Innstrammingen hører hjemme her og ikke i A5, fordi den må være på
   * plass FØR øktkapsler tas i bruk.
   */
  cors?: boolean;
}

export function vercelHandler(
  allowedMethod: "GET" | "POST",
  handler: Handler,
  valg: HandlerValg = {},
) {
  const aapenCors = valg.cors !== false;
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    if (aapenCors) for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);

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
      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query ?? {})) {
        query[k] = Array.isArray(v) ? v[0] : String(v);
      }
      const result = await handler({
        method: req.method ?? allowedMethod,
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: parseBody(req.body),
        query,
        ip,
      });
      for (const [k, v] of Object.entries(result.headers ?? {})) res.setHeader(k, v);
      if (result.cookies?.length) res.setHeader("set-cookie", result.cookies);
      if (result.html !== undefined) {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.status(result.status).send(result.html);
        return;
      }
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
