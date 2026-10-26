import { data } from "@/lib/snapshot";

export function GET() {
  return Response.json({
    total: data.reports.length,
    reports: data.reports.map((report) => ({
      case_id: report.case_id,
      reference: report.reference,
      customer_id: report.customer_id,
      customer_name: report.customer_name,
      risk_score: report.risk_score,
      risk_tier: report.risk_tier,
      str_candidate: report.str_candidate,
      lvctr_required: report.lvctr_required,
      supported: report.verification.supported,
      missing_information: report.missing_information,
    })),
  });
}
