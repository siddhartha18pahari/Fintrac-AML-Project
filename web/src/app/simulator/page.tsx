import type { Metadata } from "next";
import { PageIntro, Shell } from "@/components/Shell";
import { Simulator } from "@/components/Simulator";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Simulator" };

export default function SimulatorPage() {
  return (
    <Shell>
      <PageIntro
        kicker="Rule tuning"
        title="Move a threshold. Watch the count."
        lede="Each slider replays one number the catalogue already compared: a 24-hour total, a name score, a play ratio. The catalogue itself does not change."
      />
      <Simulator controls={data.tuning.controls} disclaimer={data.tuning.disclaimer} />
    </Shell>
  );
}
