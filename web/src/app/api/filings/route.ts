import { data } from "@/lib/snapshot";

export function GET() {
  return Response.json({
    filings: data.filings.map(({ document: _document, ...filing }) => filing),
  });
}
