import { tool } from 'langchain';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { z } from 'zod';
import { prepareResumeFormSchema, type ResumePreparationResult } from '@/shared/contracts/resume-form';
import { safeJson } from '@/shared/utils/utils';
import type { ToolBridge, TrackActionFn } from './types';
import type { ResumePreparationMode } from '../resume-workflow';

async function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('简历准备超时')), timeoutMs);
    })]);
  } finally { clearTimeout(timer!); }
}

export function createResumeTools(bridge: ToolBridge, trackAction: TrackActionFn, getPreparationMode: () => ResumePreparationMode = () => 'upload_if_missing') {
  const prepare = async (args: z.infer<typeof prepareResumeFormSchema>, config: RunnableConfig = {}) => {
    let target: ResumePreparationResult['target'];
    let filesAssigned = false;
    let uploadDispatched = false;
    let existingStatus: 'not_uploaded' | 'existing_unverified' | 'assigned_unverified' = 'not_uploaded';
    const finish = (result: ResumePreparationResult) => safeJson({ ...result, filesAssigned });
    const request = { ...args, mode: getPreparationMode() === 'existing_only' ? 'existing_only' as const : args.mode };
    const checkAbort = () => {
      if (config.signal?.aborted) {
        const error = new Error('任务已停止'); error.name = 'AbortError'; throw error;
      }
    };
    try {
      checkAbort();
      const initial = await bounded(bridge.content<ResumePreparationResult>('dom.resume.begin', request), 3_000);
      target = initial.target;
      if (initial.attachment?.status === 'assigned_unverified' || target?.assignedFileNames?.length) existingStatus = 'assigned_unverified';
      else if (target?.receiptNames?.length || ['receipt_existing', 'page_receipt_observed', 'existing_unverified'].includes(String(initial.attachment?.status))) existingStatus = 'existing_unverified';
      checkAbort();
      if (initial.reason === 'recheck_existing_receipt' && initial.watchId) {
        return finish(await bounded(bridge.content<ResumePreparationResult>('dom.resume.wait', { watchId: initial.watchId }), 35_000));
      }
      if (initial.reason === 'recheck_existing_upload' && initial.watchId && initial.attachment.metadata) {
        return finish(await bounded(bridge.content<ResumePreparationResult>('dom.resume.wait', {
          watchId: initial.watchId, attachment: initial.attachment.metadata,
        }), 35_000));
      }
      if (initial.reason !== 'upload_required' || !initial.watchId || !initial.elementId) return finish(initial);
      if (request.mode === 'existing_only') return finish({ ready: false, reason: 'existing_pdf_receipt_missing', target, attachment: { status: 'not_uploaded' } } satisfies ResumePreparationResult);
      const deadline = Date.now() + 20_000;
      const uploaded = await bounded(trackAction(() => {
        checkAbort();
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('上传前观察已超时');
        uploadDispatched = true;
        return bridge.uploadAttachment({
          elementId: initial.elementId!, revision: initial.revision,
          serverName: request.serverName, attachmentId: request.attachmentId,
        }, { mimeType: 'application/pdf', timeoutMs: remaining });
      }), 20_000);
      filesAssigned = uploaded.filesAssigned === true;
      checkAbort();
      if (!uploaded.filesAssigned) return finish({
        ready: false, reason: 'file_assignment_failed', target, attachment: { status: 'failed' },
      } satisfies ResumePreparationResult);
      return finish(await bounded(bridge.content<ResumePreparationResult>('dom.resume.wait', {
        watchId: initial.watchId, attachment: uploaded.attachment,
      }), 35_000));
    } catch {
      checkAbort();
      return finish({
        ready: false, reason: 'preparation_failed_or_timed_out', target, attachment: { status: uploadDispatched ? 'assigned_unverified' : existingStatus },
      } satisfies ResumePreparationResult);
    }
  };
  return [tool(prepare, {
    name: 'prepare_resume_form',
    description: '运行时固定前置第一步，之后会核对解析、执行牛客补填和整表扫描。优先解析区，与独立简历附件分别核验。首次定位失败且未赋值时，解析核对模型可显式指定已观察到的 elementId 再尝试；已赋值只观察，不重复赋值。已有网页回执复用，不要求旧会话哈希缓存。普通补填或已上传的描述不禁止补齐当前页缺失附件；只有明确不要上传或重传时使用 existing_only。默认 resume/resume-pdf。ready=false、异常、超时只影响该附件，继续其他已知内容；回执不明不能声称接收成功。不删除已有附件，不提交申请。',
    schema: prepareResumeFormSchema,
  }), tool((args, config) => prepare({ ...args, attachments_only: true }, config), {
    name: 'ensure_resume_attachment',
    description: '补齐明确独立的“简历附件”区域。只允许非自动解析的独立简历附件，拒绝解析区、头像、其他附件和用途不明控件；可指定已观察到的 elementId。已有回执复用，只观察已赋值文件不重复上传；按本轮上传意图执行。每个上传区分别核验，本区缺失不阻断其他填写。不删除文件，不提交。',
    schema: prepareResumeFormSchema.omit({ attachments_only: true }),
  })] as const;
}
