-- 老師定案：舊 Drive 夾 GEPT-2_sentence 的連結全部對到現用 GEPT-2。
-- 身分仍是 material_folders.id；這裡只記舊名。未套用的舊夾仍可單獨列出。
-- 學生練習專區若還存舊資料夾名，也要讀得到這條別名。

INSERT INTO public.material_name_maps (
  teacher_id, material_folder_id, kind, alias, current_label
)
SELECT mf.teacher_id, mf.id, 'folder', 'GEPT-2_sentence', mf.folder_name
FROM public.material_folders mf
WHERE mf.root_kind = 'teacher'
  AND upper(mf.folder_name) = 'GEPT-2'
  AND NOT EXISTS (
    SELECT 1 FROM public.material_name_maps m
    WHERE m.kind = 'folder'
      AND m.material_folder_id = mf.id
      AND upper(m.alias) = 'GEPT-2_SENTENCE'
  );

DROP POLICY IF EXISTS "read_material_name_maps_class_member" ON public.material_name_maps;
CREATE POLICY "read_material_name_maps_class_member"
  ON public.material_name_maps FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.class_material_combinations cmc
      JOIN public.material_combinations mc ON mc.id = cmc.material_combination_id
      WHERE mc.material_folder_id = material_name_maps.material_folder_id
        AND public.is_enrolled_student(cmc.class_id)
    )
  );
