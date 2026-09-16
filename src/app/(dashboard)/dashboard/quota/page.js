import { redirect } from "next/navigation";

// Quota Tracker merged into Usage page as "quota" tab
export default function QuotaPage() {
  redirect("/dashboard/usage?tab=quota");
}
