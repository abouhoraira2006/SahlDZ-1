import { createFileRoute } from "@tanstack/react-router";
import { HallsSettingsPageView } from "@/pages/settings-views/HallsSettingsPageView";

export const Route = createFileRoute("/dashboard/settings/halls")({
  component: HallsSettingsPageView,
});
