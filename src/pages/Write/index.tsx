import { useApp } from "../../store";
import { Compose } from "./Compose";
import { Practice } from "./Practice";
import { Finish } from "./Finish";

export function WritePage() {
  const stage = useApp((s) => s.stage);
  if (stage === "practice") return <Practice />;
  if (stage === "finish") return <Finish />;
  return <Compose />;
}
