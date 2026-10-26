import { alertById, transactionById } from "@/lib/snapshot";

export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then(({ id }) => {
    const alert = alertById(Number(id));
    if (!alert) return Response.json({ error: "alert not found" }, { status: 404 });
    const evidence = alert.evidence_txn_ids
      .map((txnId) => transactionById(txnId))
      .filter((txn) => txn !== undefined);
    return Response.json({ alert, evidence });
  });
}
