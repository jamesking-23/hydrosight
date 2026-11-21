import type { Metadata } from "next";
import { CommunityLoader } from "@/components/community-loader";
import { SiteFooter, SiteHeader } from "@/components/shell";

export const metadata: Metadata = {
  title: "HydroSight community",
  description: "Report flooding near you and see warnings for your area",
  manifest: "/manifest.webmanifest",
};

export default function CommunityPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <CommunityLoader />
      </main>
      <SiteFooter />
    </>
  );
}
