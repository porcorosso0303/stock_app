import type { CodexEnvironmentStatus } from "../../../../shared/types";
import type {
  DeepSeekAgentProgress,
  DeepSeekAgentRequest
} from "../../../deepseek-agent-runner";
import type {
  ResearchProvider,
  ResearchProviderOutputEvent,
  ResearchProviderRequest,
  ResearchProviderResult
} from "./research-provider";

interface ResearchSpecStoreLike {
  get(): Promise<string>;
}

interface DeepSeekAgentLike {
  run(request: DeepSeekAgentRequest): Promise<string>;
  cancel(): void;
}

export interface DeepSeekResearchProviderDependencies {
  model: string;
  researchSpecStore: ResearchSpecStoreLike;
  createAgent(onProgress: (event: DeepSeekAgentProgress) => void): DeepSeekAgentLike;
}

export class DeepSeekResearchProvider implements ResearchProvider {
  readonly id = "deepseek";
  readonly label = "DeepSeek";

  private activeAgent?: DeepSeekAgentLike;
  private cancelRequested = false;

  constructor(private readonly dependencies: DeepSeekResearchProviderDependencies) {}

  async detect(): Promise<CodexEnvironmentStatus> {
    return {
      available: true,
      loggedIn: true,
      version: this.dependencies.model
    };
  }

  async run(request: ResearchProviderRequest): Promise<ResearchProviderResult> {
    this.cancelRequested = false;
    const agent = this.dependencies.createAgent((event) => {
      request.onOutput(mapProgress(event));
    });
    this.activeAgent = agent;
    try {
      const researchSpec = await this.dependencies.researchSpecStore.get();
      if (this.cancelRequested) return { status: "cancelled" };
      const prompts = buildDeepSeekResearchPrompts(
        request.stockName,
        researchSpec,
        request.researchDate
      );
      const reportMarkdown = await agent.run(prompts);
      if (!reportMarkdown.trim()) {
        return { status: "failed", errorMessage: "DeepSeek 未生成调研报告" };
      }
      return { status: "success", reportMarkdown };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (this.cancelRequested || errorMessage.includes("已取消")) {
        return { status: "cancelled" };
      }
      return { status: "failed", errorMessage };
    } finally {
      if (this.activeAgent === agent) this.activeAgent = undefined;
    }
  }

  cancel(): void {
    this.cancelRequested = true;
    this.activeAgent?.cancel();
  }
}

export function buildDeepSeekResearchPrompts(
  stockName: string,
  researchSpec: string,
  researchDate: string
): DeepSeekAgentRequest {
  return {
    systemPrompt: [
      "你是严谨的 A 股上市公司研究代理。使用提供的网页搜索和正文提取工具完成当前公开信息调研。",
      "信息优先级：交易所和巨潮资讯官方公告、定期报告、公司官网及投资者关系材料最高；交易所互动平台和主流券商研报次之；权威财经媒体用于补充；论坛只可作为线索。",
      "论坛、转载和媒体说法必须尽量回到官方公告、财报、公司官网或交易所互动内容交叉验证。",
      "每个重要事实都要标注来源名称、发布日期和可直接访问的来源链接。不要编造来源、日期、财务数字或市场数据。",
      "清楚区分事实与推断：分别标明已验证事实、模型推断和仍待确认的信息；主动呈现矛盾证据、负面证据和数据局限。",
      "财务比较必须标明报告期和口径。时效性信息必须确认发布时间，避免把历史信息当作当前信息。",
      "最终输出一份完整 Markdown 调研报告，包含公司与业务、行业与竞争、财务、估值、近期重要信息、投资者互动与情绪、综合判断、风险、证据与来源。",
      "不要输出个性化投资建议、收益承诺或绝对买卖指令。"
    ].join("\n"),
    userPrompt: [
      `调研标的：${stockName}`,
      `任务日期（北京时间）：${researchDate}`,
      `报告中的“报告日期”必须写为：${researchDate}`,
      "",
      "下面是用户维护的调研规范。请完整执行其中仍然适用于该标的的要求：",
      "--- 用户调研规范开始 ---",
      researchSpec.trim(),
      "--- 用户调研规范结束 ---",
      "",
      "请先制定检索步骤并调用工具收集证据，再形成最终 Markdown 报告。"
    ].join("\n")
  };
}

function mapProgress(event: DeepSeekAgentProgress): ResearchProviderOutputEvent {
  if (event.kind === "reasoning") {
    return { kind: "reasoning", mode: "stream", text: event.text };
  }
  if (event.kind === "output") {
    return { kind: "answer", mode: "stream", text: event.text };
  }
  return {
    kind: "status",
    mode: "line",
    text: event.kind === "warning" ? `DeepSeek 警告：${event.text}` : event.text
  };
}
