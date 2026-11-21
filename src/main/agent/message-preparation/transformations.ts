import { cloneDeep } from 'lodash';
import { AIDER_TOOL_GROUP_NAME, AIDER_TOOL_RUN_PROMPT, SUBAGENTS_TOOL_GROUP_NAME, SUBAGENTS_TOOL_RUN_TASK, TOOL_GROUP_NAME_SEPARATOR } from '@common/tools';

import { getSubagentFinalText } from './tool-results';

import type { ModelMessage, TextPart, UserModelMessage, UserContent } from 'ai';

const userContentToParts = (content: UserContent): Array<TextPart | Exclude<UserContent, string>[number]> => {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content;
};

const mergeUserContent = (first: UserModelMessage['content'], second: UserModelMessage['content']): UserModelMessage['content'] => {
  if (typeof first === 'string' && typeof second === 'string') {
    return `${first}\n\n${second}`;
  }
  return [...userContentToParts(first), ...userContentToParts(second)];
};

export const mergeConsecutiveUserMessages = (messages: ModelMessage[]): ModelMessage[] => {
  const result: ModelMessage[] = [];
  for (const message of messages) {
    const previous = result[result.length - 1];
    if (message.role === 'user' && previous?.role === 'user') {
      result[result.length - 1] = {
        role: 'user',
        content: mergeUserContent(previous.content, message.content),
      };
      continue;
    }
    result.push(message);
  }
  return result;
};

export const transformMessages = (messages: ModelMessage[]): ModelMessage[] => {
  const transformedMessages = cloneDeep(messages);
  for (const message of transformedMessages) {
    if (message.role !== 'tool') {
      continue;
    }
    for (const part of message.content) {
      if (part.type !== 'tool-result' || part.output.type !== 'json') {
        continue;
      }
      if (part.toolName === `${AIDER_TOOL_GROUP_NAME}${TOOL_GROUP_NAME_SEPARATOR}${AIDER_TOOL_RUN_PROMPT}`) {
        const result = part.output.value;
        if (result && typeof result === 'object' && !Array.isArray(result)) {
          part.output = {
            ...part.output,
            value: Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'responses' && key !== 'promptContext')),
          };
        }
      } else if (part.toolName === `${SUBAGENTS_TOOL_GROUP_NAME}${TOOL_GROUP_NAME_SEPARATOR}${SUBAGENTS_TOOL_RUN_TASK}`) {
        const text = getSubagentFinalText(part.output.value);
        if (text !== undefined) {
          part.output = { type: 'text', value: text };
        }
      }
    }
  }
  return mergeConsecutiveUserMessages(transformedMessages);
};
