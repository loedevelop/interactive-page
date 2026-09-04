-- 寫入套餐後前端呼叫 refresh_combo_statistics，再 fetch 最新列。
GRANT EXECUTE ON FUNCTION public.refresh_combo_statistics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_combo_statistics_for_sheet(uuid) TO authenticated;
