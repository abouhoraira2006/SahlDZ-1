import { createFileRoute } from "@tanstack/react-router";
import { HallsSettingsPageView } from "@/pages/settings-views/HallsSettingsPageView";

export const Route = createFileRoute("/account/settings/halls")({
  component: HallsSettingsPageView,
});
