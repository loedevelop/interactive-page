# 專案實體架構地圖 (Project Map)

> 這是系統自動生成的目錄結構，供 AI 快速掌握全域檔案分佈。

```text
├── .github
│   └── PULL_REQUEST_TEMPLATE.md
├── 010_css
│   └── style.css
├── 020_js_core
│   ├── api.js
│   ├── assignment-clone.js
│   ├── auth-guard.js
│   ├── config.js
│   ├── grading-policy.js
│   ├── layout-fields-eval.js
│   ├── material-file-names.js
│   ├── material-folder-picker.js
│   ├── material-name-map.js
│   ├── material-pdf-page-map.js
│   ├── material-snapshot.js
│   ├── message-layout-template.js
│   ├── modal-overlay.js
│   ├── pdf-exam-paper.js
│   ├── persona-routing.js
│   ├── profile-form.js
│   ├── quiz-paper-builder.js
│   ├── review-zone.js
│   ├── sheet-range-bounds.js
│   ├── store-side-tables.js
│   ├── store.js
│   ├── supabase-client.js
│   ├── task-script-resolver.js
│   ├── teacher-prefs.js
│   ├── ui-flash.js
│   └── utils-date.js
├── 110_teacher_core
│   ├── .DS_Store
│   ├── api-gas-service.js
│   ├── api-gradebook.js
│   ├── api-quiz-review.js
│   ├── feature-ai-backfill.js
│   ├── feature-archived-classes.js
│   ├── feature-audio-split-upload.js
│   ├── feature-class-material-combinations.js
│   ├── feature-class-members.js
│   ├── feature-class.js
│   ├── feature-exam-job.js
│   ├── feature-exam-review.js
│   ├── feature-exam-template-editor.js
│   ├── feature-gadget-center.js
│   ├── feature-gradebook.js
│   ├── feature-material-book.js
│   ├── feature-material-layout-pairing.js
│   ├── feature-material-pdf-exam.js
│   ├── feature-material-publish.js
│   ├── feature-member-management.js
│   ├── feature-message-layout-editor.js
│   ├── feature-pdf-exam-job.js
│   ├── feature-profile.js
│   ├── feature-progress.js
│   ├── feature-reminder-image.js
│   ├── feature-resource.js
│   ├── feature-review-catalog.js
│   ├── feature-review-records.js
│   ├── feature-script-collector.js
│   ├── feature-template-library.js
│   ├── feature-timeline.js
│   ├── material-combo-strategies.js
│   ├── service-line-notify.js
│   ├── store-assignment-builder.js
│   ├── store-gradebook.js
│   ├── teacher-class-dataset.js
│   ├── ui-class-templates.js
│   ├── ui-core.js
│   ├── ui-gradebook-templates.js
│   └── ui-timeline-templates.js
├── 120_student_core
│   ├── feature-student-analytics.js
│   ├── feature-student-audio.js
│   ├── feature-student-messages.js
│   ├── feature-student-pdf-quiz.js
│   ├── feature-student-quiz.js
│   ├── feature-student-resource.js
│   ├── feature-student-review.js
│   ├── feature-student-timeline.js
│   ├── ui-audio-templates.js
│   └── ui-student-timeline-templates.js
├── admin
│   ├── admin-users.js
│   └── index.html
├── docs
│   ├── AGENT_Material_Publish.md
│   ├── AGENT_PROMPT_Material_Phase1.md
│   ├── feature-prompt_quiz-fill-blank.md
│   ├── hand-off_prompt.md
│   ├── handoff-prompt.md
│   ├── Material_Publish_Spec.md
│   ├── quiz-json-contract-v0.1.md
│   ├── quiz-json-contract-v0.2.md
│   ├── README.md
│   ├── 標題範圍處理規則.md
│   ├── 活頁總題數與可用題.md
│   ├── 班級預設與派發規格.md
│   ├── 組合作業範圍與套餐.md
│   └── 雷區撰寫規範.md
├── gas
│   └── Code.gs
├── grammar
│   └── used_to
│       └── index.html
├── material_templates
│   ├── _Config.csv
│   ├── _Layout.csv
│   ├── _Publish.csv
│   ├── _Schema.csv
│   ├── _Setup.csv
│   ├── _Student_Display_Template.txt
│   ├── convert_to_setup.py
│   ├── convert_to_setup.sh
│   ├── publish_local.py
│   ├── publish_local.sh
│   ├── README.md
│   └── requirements-publish.txt
├── SHS-Cloze
│   ├── unit05
│   │   ├── audio
│   │   │   └── .keep
│   │   ├── css
│   │   │   └── style.css
│   │   ├── data
│   │   │   ├── articles.js
│   │   │   ├── dictionary.js
│   │   │   └── vocab.js
│   │   ├── js
│   │   │   ├── editor.js
│   │   │   ├── main.js
│   │   │   ├── store.js
│   │   │   ├── ui.js
│   │   │   └── utils.js
│   │   └── index.html
│   ├── unit05_all
│   │   └── index.html
│   └── index.html
├── student
│   └── index.html
├── supabase
│   ├── .temp
│   │   ├── cli-latest
│   │   ├── gotrue-version
│   │   ├── linked-project.json
│   │   ├── pooler-url
│   │   ├── postgres-version
│   │   ├── project-ref
│   │   ├── rest-version
│   │   ├── storage-migration
│   │   └── storage-version
│   ├── functions
│   │   ├── admin_create_user
│   │   │   └── index.ts
│   │   ├── build-review-paper
│   │   │   └── index.ts
│   │   ├── due-reminders
│   │   │   └── index.ts
│   │   ├── line-notify
│   │   │   └── index.ts
│   │   ├── process-audio-ai
│   │   │   ├── deno.json
│   │   │   ├── index.ts
│   │   │   └── index.ts.bak-stable
│   │   ├── stream-audio
│   │   │   ├── .DS_Store
│   │   │   └── index.ts
│   │   └── .DS_Store
│   ├── migrations
│   │   ├── 20260726070000_enable_rls_sensitive_tables.sql
│   │   ├── 20260726120000_archived_classes_rpc.sql
│   │   ├── 20260726130000_fix_archived_classes_list.sql
│   │   ├── 20260726140000_fix_archived_class_assignments.sql
│   │   ├── 20260726150000_staff_update_member_profile.sql
│   │   ├── 20260726160000_fix_restore_class_enrollments.sql
│   │   ├── 20260726180000_user_notifications_due_reminders.sql
│   │   ├── 20260726190000_refine_due_reminder_messages.sql
│   │   ├── 20260727103000_staff_update_member_profile_add_email_secondary.sql
│   │   ├── 20260727120000_due_reminder_missed_and_makeup.sql
│   │   ├── 20260727130000_fix_overdue_allow_late_badge.sql
│   │   ├── 20260727140000_makeup_reminder_two_waves.sql
│   │   ├── 20260727150000_student_uncheck_task_completions.sql
│   │   ├── 20260728090000_resources_scope_teacher.sql
│   │   ├── 20260728100000_drop_legacy_submit_audio_overload.sql
│   │   ├── 20260729090000_audio_multi_segment_grading.sql
│   │   ├── 20260801110000_fix_assignment_id_mixed_type.sql
│   │   ├── 20260801130000_fix_all_assignment_id_rpcs.sql
│   │   ├── 20260801140000_unify_assignments_id_to_uuid.sql
│   │   ├── 20260801150000_create_student_task_progress.sql
│   │   ├── 20260801160000_merge_audio_segments_on_resubmit.sql
│   │   ├── 20260814094500_fix_student_set_task_completion_incomplete_raw_data.sql
│   │   ├── 20260814150000_material_relations_normalize.sql
│   │   ├── 20260814151500_fix_material_sheets_legacy_stem_suffix.sql
│   │   ├── 20260814152500_fix_material_layout_templates_field_names.sql
│   │   ├── 20260814153000_restore_material_sheets_layout_name_suffix.sql
│   │   ├── 20260814154000_reset_material_sheets_stuck_local_source.sql
│   │   ├── 20260814160000_rename_layout_template_to_extraction_template.sql
│   │   ├── 20260814161000_create_material_exam_templates.sql
│   │   ├── 20260814162000_create_material_combination_exam_templates.sql
│   │   ├── 20260814163000_soft_delete_unused_builtin_exam_templates.sql
│   │   ├── 20260814170000_create_material_templates_unified.sql
│   │   ├── 20260814171000_refk_material_templates.sql
│   │   ├── 20260814172000_deprecate_old_template_tables.sql
│   │   ├── 20260814180000_material_templates_sort_order.sql
│   │   ├── 20260816160000_student_review_zone.sql
│   │   ├── 20260818130000_material_combination_source_labels.sql
│   │   ├── 20260818140000_material_name_maps.sql
│   │   ├── 20260819160000_material_name_maps_template.sql
│   │   ├── 20260819210000_fetch_class_combo_stats.sql
│   │   ├── 20260820163000_gept2_sentence_folder_alias.sql
│   │   ├── 20260821140000_material_sheets_unique_folder_stem_template.sql
│   │   ├── 20260821210000_material_name_maps_sheet_alias_unique.sql
│   │   ├── 20260821220000_material_sheets_is_group.sql
│   │   ├── 20260821230000_class_review_catalog_extraction_template.sql
│   │   ├── 20260822010000_material_templates_student_script.sql
│   │   ├── 20260822020000_material_combinations_student_pdf.sql
│   │   ├── 20260822130000_material_sheets_available_count.sql
│   │   ├── 20260823220000_combo_default_labels_one_sheet.sql
│   │   ├── 20260823230000_delete_mason_empty_combo_shell.sql
│   │   ├── 20260824120000_class_combo_statistics.sql
│   │   ├── 20260824140000_class_script_blocks.sql
│   │   ├── 20260824150000_class_combo_statistics_source_file.sql
│   │   ├── 20260826180000_combo_statistics_table.sql
│   │   ├── 20260827120000_grant_refresh_combo_statistics.sql
│   │   ├── 20260829120000_material_pdf_exam_items.sql
│   │   ├── 20260829130000_material_pdf_exam_items_is_group.sql
│   │   ├── 20260829200000_material_book_combos.sql
│   │   └── 20260901120000_class_material_pdf_exam_items.sql
│   └── .DS_Store
├── teacher
│   └── index.html
├── tools
│   └── split_and_upload_audio.py
├── verbIrregular
│   ├── css
│   │   └── styles.css
│   ├── data
│   │   ├── sentence_phrase.json
│   │   ├── sentence_verbtense.json
│   │   └── verbs.json
│   ├── js
│   │   ├── exporter.js
│   │   ├── main.js
│   │   ├── render.js
│   │   ├── service.js
│   │   └── store.js
│   └── index.html
├── .cursorignore
├── .cursorrules
├── .DS_Store
├── .gitignore
├── Azar-2-5th_test_01_compressed.pdf
├── Azar-2-5th_test_01.pdf
├── Azar-2-5th_test_02_compressed.pdf
├── Azar-2-5th_test_02.pdf
├── Azar-2-5th_test_03_compressed.pdf
├── Azar-2-5th_test_03.pdf
├── Azar-2-5th_test_04_compressed.pdf
├── Azar-2-5th_test_04.pdf
├── Azar-2-5th_test_unit04.pdf
├── generate-map.js
├── index.html
└── reset-password.html
```
