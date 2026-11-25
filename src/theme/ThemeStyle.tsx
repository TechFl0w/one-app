"use client";

import { useEdit } from "@/components/edit/EditProvider";
import { cssDeclarations, themeFontsHref, themeVars } from "./theme";

/** Applies the business's theme (from the live, possibly draft, blueprint) to the whole app. */
export function ThemeStyle() {
  const { blueprint } = useEdit();
  const vars = themeVars(blueprint.theme);
  const href = themeFontsHref(blueprint.theme);
  if (!Object.keys(vars).length && !href) return null;
  return (
    <>
      {href && <link rel="stylesheet" href={href} />}
      <style>{`:root{${cssDeclarations(vars)}}`}</style>
    </>
  );
}
