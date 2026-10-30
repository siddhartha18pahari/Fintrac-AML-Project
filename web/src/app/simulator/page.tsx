import type { Metadata } from "next";
import { BankSimulator } from "@/components/bank-sim/BankSimulator";
import { PageIntro, Shell } from "@/components/Shell";
import { Simulator } from "@/components/Simulator";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Simulator" };

export default function SimulatorPage() {
  return (
    <Shell wide>
      <PageIntro
        kicker="Synthetic bank"
        title="A Canadian book, played forward."
        lede="Customers, businesses, merchants and correspondent banks keep ordinary hours: paydays, rent, bills, Interac, cards, cash and wires. Planted labels sit on the transactions so precision, recall and time-to-detect are scored against a known script. The labels are not a finding, and they are not a way to move value."
      />
      <BankSimulator />
      <h2 className="mb-3 mt-10 font-display text-3xl text-spruce">Catalogue replay</h2>
      <Simulator controls={data.tuning.controls} disclaimer={data.tuning.disclaimer} />
    </Shell>
  );
}
