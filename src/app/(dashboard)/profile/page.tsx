import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/settings/ProfileForm";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--ata-gray-900)", margin: 0 }}>
        Profile
      </h1>
      <p style={{ fontSize: 13, color: "var(--ata-gray-600)", marginTop: 4 }}>
        Update your name, role, and password.
      </p>

      <div style={{ marginTop: 24 }}>
        <ProfileForm
          email={user.email ?? ""}
          initialFirstName={(meta.firstName as string | undefined) ?? ""}
          initialLastName={(meta.lastName as string | undefined) ?? ""}
          initialPosition={(meta.position as string | undefined) ?? ""}
        />
      </div>
    </div>
  );
}
