import { DemoForm } from "@/components/demo-form";
import { PublicShell } from "@/components/content-page";

export const metadata = { title: "Request a demo | HydroSight" };

export default function Demo() {
  return (
    <PublicShell>
      <h1 className="max-w-[20ch] text-4xl font-extrabold md:text-5xl">
        Request a demo
      </h1>
      <p className="mt-5 max-w-[60ch] text-xl text-muted">
        Tell us about your organisation. Your request is saved for the
        HydroSight team to read.
      </p>
      <div className="mt-8 max-w-xl">
        <DemoForm />
      </div>
    </PublicShell>
  );
}
