"use client";

import { PageHeader } from "@/components/ui/page-header";
import { LiveMap } from "@/components/dashboard/live-map";

export default function MapPage() {
  return (
    <div className="space-y-4">
      <PageHeader tkey="map" />
      <LiveMap heightClass="h-[70vh]" />
    </div>
  );
}
