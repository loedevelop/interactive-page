-- 套餐學生文稿 PDF：檔案頁 ≠ 課本頁，另外對照。
alter table public.material_combinations
    add column if not exists student_pdf_file_id text,
    add column if not exists student_pdf_file_name text not null default '',
    add column if not exists student_pdf_page_map jsonb not null default '[]'::jsonb;

comment on column public.material_combinations.student_pdf_file_id is '教材資料夾裡的學生文稿 PDF（Drive file id）';
comment on column public.material_combinations.student_pdf_file_name is 'PDF 檔名';
comment on column public.material_combinations.student_pdf_page_map is '對照列 [{range_type, book_start, book_end, pdf_start, pdf_end}]';
