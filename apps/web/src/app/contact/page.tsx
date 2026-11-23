import { ContentPage } from "@/components/content-page";
import { DemoForm } from "@/components/demo-form";
import { page } from "@/lib/site-content";

export const metadata = { title: "Contact | HydroSight" };

export default function Contact() {
  return (
    <ContentPage
      c={page("contact")}
      extra={
        <section className="mt-12 max-w-xl border-t border-line pt-6">
          <h2 className="mb-4 text-xl font-bold">Request a demo</h2>
          <DemoForm />
        </section>
      }
    />
  );
}
