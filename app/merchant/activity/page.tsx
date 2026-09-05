import { redirect } from "next/navigation";

export default function ActivityPage() {
  redirect("/app/approvals?tab=audit");
}
