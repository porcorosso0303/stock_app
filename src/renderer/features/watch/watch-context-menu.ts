import type { WatchTreeNode } from "../../../shared/types";
import { escapeHtml } from "./watch-view";

export function openWatchNodeContextMenu(
  menu: HTMLElement,
  node: WatchTreeNode,
  event: MouseEvent
): void {
  menu.innerHTML = node.type === "category"
    ? `
      <button data-watch-menu-action="add-category" data-watch-id="${escapeHtml(node.id)}" type="button">添加子分类</button>
      <button data-watch-menu-action="add-stock" data-watch-id="${escapeHtml(node.id)}" type="button">添加子股票</button>
      <button data-watch-menu-action="edit" data-watch-id="${escapeHtml(node.id)}" type="button">编辑节点</button>
      <button data-watch-menu-action="delete" data-watch-id="${escapeHtml(node.id)}" type="button">删除节点</button>
    `
    : `
      ${node.isHolding ? `
        <button data-watch-menu-action="refresh-news" data-watch-id="${escapeHtml(node.id)}" type="button">最新消息</button>
        <button data-watch-menu-action="show-news" data-watch-id="${escapeHtml(node.id)}" type="button">显示消息</button>
      ` : ""}
      <button data-watch-menu-action="edit" data-watch-id="${escapeHtml(node.id)}" type="button">编辑股票</button>
      <button data-watch-menu-action="delete" data-watch-id="${escapeHtml(node.id)}" type="button">删除股票</button>
    `;
  showMenu(menu, event);
}

export function openEmptyWatchContextMenu(menu: HTMLElement, event: MouseEvent): void {
  menu.innerHTML = '<button data-watch-menu-action="create-category" type="button">创建分类</button>';
  showMenu(menu, event);
}

export function openWatchWorkspaceContextMenu(
  menu: HTMLElement,
  workspaceId: string,
  event: MouseEvent
): void {
  menu.innerHTML = `
    <button data-watch-menu-action="rename-workspace" data-watch-id="${escapeHtml(workspaceId)}" type="button">重命名</button>
  `;
  showMenu(menu, event);
}

export function closeWatchContextMenu(menu: HTMLElement): void {
  menu.hidden = true;
}

function showMenu(menu: HTMLElement, event: MouseEvent): void {
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.hidden = false;
}
