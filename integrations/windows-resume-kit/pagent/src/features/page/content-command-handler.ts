import { pageObserver } from './observer';
import {
  clearElement,
  clickElement,
  dblclickElement,
  findCommonAncestor,
  focusElement,
  hoverElement,
  inspectElementTree,
  interactElements,
  verifyFormFields,
  pressKey,
  runNamedScript,
  scrollPage,
  selectOption,
  typeText,
  waitFor,
  dragElement,
} from './actions';
import { getRememberedSelection } from './selection';
import { searchPageText } from './search';
import { getPageSource } from './source';
import { assignAttachment, inspectAttachmentTarget } from './actions/attachments';
import { beginResumePreparation, waitForResumePreparation } from './actions/resume-form';
import { scanResumeForm } from './actions/resume-scan';
import { parseRpcPayload } from '@/shared/contracts/rpc';
import type { AssignAttachmentRequest } from '@/shared/contracts/attachments';
import { bossAssign, bossFilter, bossHistoryTop, bossListScroll, bossSelect, bossState, type BossAssignRequest } from '@/features/boss/content-adapter';
import { favoritesAssignImage, favoritesChatState, favoritesInspect, favoritesNext, favoritesRemove, favoritesSendText,
  favoritesStageText, favoritesStart, favoritesState } from '@/features/boss/favorites-content';
import type {
  InteractionStep,
  FormFieldExpectation,
  NamedScript,
  ObservationScope,
  SourceType,
} from '@/shared/contracts/page';
import {
  pageChangeTracker,
  type PageChangeSnapshot,
} from './change-tracker';

export function handleContentCommand(name: string, payload: Record<string, unknown>) {
  switch (name) {
    case 'boss.favorites.state':
      return favoritesState();
    case 'boss.favorites.next':
      return favoritesNext(payload as Parameters<typeof favoritesNext>[0]);
    case 'boss.favorites.start':
      return favoritesStart(payload as Parameters<typeof favoritesStart>[0]);
    case 'boss.favorites.remove':
      return favoritesRemove(payload as Parameters<typeof favoritesRemove>[0]);
    case 'boss.favorites.chat':
      return favoritesChatState(payload as Parameters<typeof favoritesChatState>[0]);
    case 'boss.favorites.inspect':
      return favoritesInspect(payload as Parameters<typeof favoritesInspect>[0]);
    case 'boss.favorites.stageText':
      return favoritesStageText(payload as Parameters<typeof favoritesStageText>[0]);
    case 'boss.favorites.sendText':
      return favoritesSendText(payload as Parameters<typeof favoritesSendText>[0]);
    case 'boss.favorites.assignImage':
      return favoritesAssignImage(payload as Parameters<typeof favoritesAssignImage>[0]);
    case 'boss.state':
      return bossState();
    case 'boss.filter':
      return bossFilter();
    case 'boss.listScroll':
      if (payload.direction !== 'top' && payload.direction !== 'next') throw new Error('联系人滚动方向无效');
      return bossListScroll(payload.direction);
    case 'boss.select':
      if (typeof payload.key !== 'string' || !payload.key) throw new Error('联系人定位信息无效');
      return bossSelect(payload.key);
    case 'boss.historyTop':
      return bossHistoryTop();
    case 'boss.assign':
      return bossAssign(payload as BossAssignRequest);
    case 'ui.toggle':
    case 'ui.open':
    case 'ui.collapse':
    case 'ui.hide':
    case 'ui.capture.start':
    case 'ui.capture.end':
      return { ok: true, uiCommand: name };
    case 'dom.observe':
      return pageObserver.observe(
        document,
        Number(payload.maxElements ?? 140),
        payload.scope as ObservationScope | undefined,
        Number(payload.offset ?? 0),
      );
    case 'dom.changes.start':
      return pageChangeTracker.snapshot(Number(payload.maxNodes ?? 400));
    case 'dom.changes.read':
      return pageChangeTracker.read(payload.baseline as PageChangeSnapshot, {
        timeoutMs: payload.timeoutMs as number | undefined,
        quietMs: payload.quietMs as number | undefined,
        maxChanges: payload.maxChanges as number | undefined,
      });
    case 'dom.search':
      return searchPageText(String(payload.query ?? ''), {
        caseSensitive: Boolean(payload.caseSensitive),
        maxResults: payload.maxResults as number | undefined,
        scope: payload.scope as ObservationScope | undefined,
      });
    case 'dom.click':
      return clickElement(String(payload.elementId), payload.revision as number | undefined);
    case 'dom.dblclick':
      return dblclickElement(String(payload.elementId), payload.revision as number | undefined);
    case 'dom.hover':
      return hoverElement(String(payload.elementId), payload.revision as number | undefined);
    case 'dom.focus':
      return focusElement(String(payload.elementId), payload.revision as number | undefined);
    case 'dom.type':
      return typeText(String(payload.elementId), String(payload.text ?? ''), {
        mode: payload.mode as 'replace' | 'append' | undefined,
        clear: typeof payload.clear === 'boolean' ? payload.clear : undefined,
        submit: Boolean(payload.submit),
        revision: payload.revision as number | undefined,
      });
    case 'dom.attachmentTarget':
      return inspectAttachmentTarget(String(payload.elementId), payload.revision as number | undefined, payload.avatarOnly === true);
    case 'dom.assignAttachment':
      return assignAttachment(payload as AssignAttachmentRequest);
    case 'dom.resume.begin': {
      const request = parseRpcPayload('dom.resume.begin', payload);
      return beginResumePreparation(request.elementId, request.revision, request.serverName, request.attachmentId, request.mode, request.attachments_only);
    }
    case 'dom.resume.wait': {
      const request = parseRpcPayload('dom.resume.wait', payload);
      return waitForResumePreparation(request.watchId, request.attachment);
    }
    case 'dom.resume.scan':
      return scanResumeForm();
    case 'dom.clear':
      return clearElement(String(payload.elementId), payload.revision as number | undefined);
    case 'dom.select':
      return selectOption(
        String(payload.elementId),
        String(payload.value ?? ''),
        payload.revision as number | undefined,
      );
    case 'dom.interact':
      return interactElements(payload.steps as InteractionStep[]);
    case 'dom.verifyFields':
      return verifyFormFields(payload.fields as FormFieldExpectation[]);
    case 'dom.press':
      return pressKey(String(payload.key ?? 'Enter'));
    case 'dom.drag':
      return dragElement(
        String(payload.elementId),
        String(payload.targetId),
        payload.revision as number | undefined,
      );
    case 'dom.scroll':
      return scrollPage({
        elementId: payload.elementId ? String(payload.elementId) : undefined,
        direction: payload.direction as 'up' | 'down' | undefined,
        amount: payload.amount as number | undefined,
        revision: payload.revision as number | undefined,
      });
    case 'dom.wait':
      return waitFor({
        ms: payload.ms as number | undefined,
        text: payload.text as string | undefined,
        elementId: payload.elementId as string | undefined,
        urlIncludes: payload.urlIncludes as string | undefined,
      });
    case 'dom.script':
      return runNamedScript(payload.name as NamedScript, {
        scope: payload.scope as ObservationScope | undefined,
        maxElements: payload.maxElements as number | undefined,
        offset: payload.offset as number | undefined,
      });
    case 'dom.elementTree':
      return inspectElementTree(String(payload.elementId), {
        revision: payload.revision as number | undefined,
        fields: payload.fields as {
          text?: boolean;
          coordinates?: boolean;
          attributes?: string[];
        } | undefined,
        maxDepth: payload.maxDepth as number | undefined,
        maxLength: payload.maxLength as number | undefined,
      });
    case 'dom.commonAncestor':
      return findCommonAncestor(
        (payload.elementIds as string[]).map(String),
        payload.revision as number | undefined,
      );
    case 'page.info':
      return {
        url: location.href,
        title: document.title,
        selection: getRememberedSelection(),
        documentId: pageObserver.documentId,
        revision: pageObserver.revision,
      };
    case 'page.source':
      return getPageSource({
        type: payload.type as SourceType | undefined,
        grep: payload.grep ? String(payload.grep) : undefined,
        regex: payload.regex as boolean | undefined,
        caseSensitive: payload.caseSensitive as boolean | undefined,
        limit: payload.limit as number | undefined,
        offset: payload.offset as number | undefined,
      });
    default:
      throw new Error(`未知内容命令：${name}`);
  }
}
