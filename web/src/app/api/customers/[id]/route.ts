import { alertsForCustomer, anomalyForCustomer, customerById, transactionsForCustomer } from "@/lib/snapshot";

export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then(({ id }) => {
    const customer = customerById(Number(id));
    if (!customer) return Response.json({ error: "customer not found" }, { status: 404 });
    return Response.json({
      customer,
      alerts: alertsForCustomer(customer.id),
      transactions: transactionsForCustomer(customer.id),
      anomaly: anomalyForCustomer(customer.id) ?? null,
    });
  });
}
