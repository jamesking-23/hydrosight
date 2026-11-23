import { ContentPage } from "@/components/content-page";
import { page } from "@/lib/site-content";

export const metadata = { title: page("industries").title + " | HydroSight" };

export default function Page() {
  return <ContentPage c={page("industries")} />;
}
