"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateItem } from "@/app/actions";
import { ItemForm, type FormValues } from "@/components/item-form";
import { useT } from "@/lib/i18n/client";
import type { ItemType } from "@/lib/parser";
import type { QuietSettings } from "@/lib/quiet";
import type { Course, Space } from "@/lib/types";

export function EditItem({ initial, spaces, courses, showSpaces, itemId, enabledTypes, quiet }: { quiet?: QuietSettings; initial: FormValues; spaces: Space[]; courses: Course[]; showSpaces: boolean; itemId: string; enabledTypes: ItemType[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="btn-quiet w-full" onClick={() => setOpen(true)}>
        ✏️ {t("action.edit")}
      </button>
    );
  }
  return (
    <section className="card slide-in p-5" aria-label={t("action.edit")}>
      <ItemForm
        initial={initial}
        spaces={spaces}
        courses={courses}
        enabledTypes={enabledTypes}
        quiet={quiet}
        showSpaces={showSpaces}
        submitLabel={t("action.save")}
        onSubmit={async (values) => {
          const r = await updateItem(itemId, values);
          if (r.ok) {
            setOpen(false);
            router.refresh();
          }
          return r;
        }}
        onCancel={() => setOpen(false)}
      />
    </section>
  );
}
