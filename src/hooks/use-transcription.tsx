import { useState } from "react";
import { useSetting } from "@/data/hooks";
import { settingsRepo } from "@/data/repo";
import { TranscriptionDisclosure } from "@/components/at/ui";

/** Live transcription is off by default and needs a one-time disclosure. */
export function useTranscriptionSetting() {
  const enabled = useSetting<boolean>("liveTranscription", false);
  const consent = useSetting<string | null>("transcriptionConsent", null);
  const [ask, setAsk] = useState(false);
  const enable = () => (consent === "granted" ? void settingsRepo.set("liveTranscription", true) : setAsk(true));
  const disable = () => void settingsRepo.set("liveTranscription", false);
  const sheet = (
    <TranscriptionDisclosure
      open={ask}
      onEnable={async () => {
        await settingsRepo.set("transcriptionConsent", "granted");
        await settingsRepo.set("liveTranscription", true);
        setAsk(false);
      }}
      onDecline={async () => {
        await settingsRepo.set("transcriptionConsent", "declined");
        setAsk(false);
      }}
    />
  );
  return { enabled, enable, disable, sheet };
}
