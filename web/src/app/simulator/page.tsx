import type { Metadata } from "next";
import { BookSimulator } from "@/components/BookSimulator";
import { PageIntro, Shell } from "@/components/Shell";
import { Simulator } from "@/components/Simulator";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Simulator" };

export default function SimulatorPage() {
  return (
    <Shell>
      <PageIntro
        kicker="Book and thresholds"
        title="Generate a day, then move a threshold."
        lede="The book simulator draws personas, lognormal amounts, payroll and rent, and planted typologies. Rule hits update as you move the controls. Below that, the catalogue sliders replay numbers the detection run already compared."
      />
      <BookSimulator />
      <h2 className="mb-3 mt-10 font-display text-3xl text-spruce">Catalogue replay</h2>
      <Simulator controls={data.tuning.controls} disclaimer={data.tuning.disclaimer} />
    </Shell>
  );
}
