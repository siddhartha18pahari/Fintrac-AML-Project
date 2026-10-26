import { alertsCiting } from "@/lib/queries";
import { transactionById } from "@/lib/snapshot";

export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then(({ id }) => {
    const transaction = transactionById(Number(id));
    if (!transaction) return Response.json({ error: "transaction not found" }, { status: 404 });
    return Response.json({ transaction, alerts: alertsCiting(transaction.id) });
  });
}
