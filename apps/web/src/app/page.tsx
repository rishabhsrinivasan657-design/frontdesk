import { redirect } from "next/navigation";

/** The demo's front door is the receptionist itself. */
export default function Home() {
  redirect("/talk");
}
