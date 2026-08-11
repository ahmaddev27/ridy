"use client";

import { useParams } from "next/navigation";
import { CompanyDetail } from "../company-detail-modal";

export default function CompanyDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  if (!Number.isFinite(id)) return null;
  return <CompanyDetail id={id} />;
}
