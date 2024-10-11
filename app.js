import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";
import fs from "node:fs/promises";
import path from "node:path";
import { extractPossibleJson } from "./util.js";

dotenv.config();

async function getApiKeys() {
  try {
    const keysPath = path.join(process.cwd(), '/data/keys.json');
    const keysData = await fs.readFile(keysPath, 'utf-8');
    return JSON.parse(keysData);
  } catch (error) {
    console.error("读取 keys.json 文件时出错:", error);
    return {};
  }
}

if (!process.env.DIFY_API_URL) throw new Error("DIFY API URL is required.");
console.log("DIFY_API_URL:", process.env.DIFY_API_URL);
console.log("using keys:", await getApiKeys());

function generateId() {
  let result = "";
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 29; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}
const app = express();
app.use(bodyParser.json());
const botType = process.env.BOT_TYPE || 'Chat';
const inputVariable = process.env.INPUT_VARIABLE || '';
const outputVariable = process.env.OUTPUT_VARIABLE || '';

let apiPath;
switch (botType) {
  case 'Chat':
    apiPath = '/chat-messages';
    break;
  case 'Completion':
    apiPath = '/completion-messages';
    break;
  case 'Workflow':
    apiPath = '/workflows/run';
    break;
  default:
    throw new Error('Invalid bot type in the environment variable.');
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

app.use((req, res, next) => {
  res.set(corsHeaders);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  console.log('Request Method:', req.method); 
  console.log('Request Path:', req.path);
  next();
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>DIFY2OPENAI</title>
      </head>
      <body>
        <h1>Dify2OpenAI</h1>
        <p>Congratulations! Your project has been successfully deployed.</p>
      </body>
    </html>
  `);
});

app.get('/v1/models', async (req, res) => {
  try {
    const apiKeys = await getApiKeys();
    const models = {
      "object": "list",
      "data": Object.keys(apiKeys).map(key => ({
        "id": key,
        "object": "model",
        "owned_by": "dify",
        "permission": null,
      }))
    };
    res.json(models);
  } catch (error) {
    console.error("获取模型列表时出错:", error);
    res.status(500).json({ error: "获取模型列表时发生错误。" });
  }
});

app.post("/v1/chat/completions", async (req, res) => {
  let apiKey;
  try {
    const data = req.body;
    const messages = data.messages;
    console.log("client send data:", JSON.stringify(data, null, 2));

    // 从messages中获取system message的内容
    let systemMessage = '';
    for (const message of messages) {
      if (message.role === 'system') {
        systemMessage = message.content;
        break;
      }
    }
    //console.log("系统消息内容:", systemMessage);
    console.log("model:", data.model);
    console.log("wf:", data.wf);

    const { possibleJson, remainingString } = extractPossibleJson(systemMessage);
    // console.log("可能的JSON对象:", possibleJson);
    // console.log("剩余字符串:", remainingString);

    const apiKeys = await getApiKeys();
    if (data.wf || data.model === 'BackOffice') {
      // 如果请求体中包含 wf 参数，从 keys.json 获取 API 密钥
      apiKey = apiKeys[data.wf ?? 'backoffice'];
      if (!apiKey) {
        return res.status(400).json({
          code: 400,
          errmsg: "无效的 wf 参数。未找到对应的 API 密钥。",
        });
      }
    } else if(data.model && apiKeys[data.model]) {
      apiKey = apiKeys[data.model];
    }
    else {
      // 否则，使用原有的授权头方式
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (!authHeader) {
        return res.status(401).json({
          code: 401,
          errmsg: "未授权。",
        });
      }
      const keys = await getApiKeys();
      apiKey = keys[Object.keys(keys)[0]];
      // apiKey = authHeader.split(" ")[1];
      // if (!apiKey) {
      //   return res.status(401).json({
      //     code: 401,
      //     errmsg: "未授权。",
      //   });
      // }
    }

    // 从请求体获取 botType,如果不存在则使用环境变量
    const requestBotType = possibleJson?.bot || data.bot || botType;
    
    let apiPath;
    switch (requestBotType) {
      case 'Chat':
        apiPath = '/chat-messages';
        break;
      case 'Completion':
        apiPath = '/completion-messages';
        break;
      case 'Workflow':
        apiPath = '/workflows/run';
        break;
      default:
        throw new Error('无效的 bot 类型。');
    }

    let queryString;
    let cmdString, cmdArgString;
    if (requestBotType === 'Chat') {
      const lastMessage = messages[messages.length - 1];

      queryString = lastMessage.content;

      if (typeof queryString === 'string') {
        const arrStrings = queryString.split(':')
          .map(a => a.trim());
        cmdString = arrStrings[0];
        cmdArgString = arrStrings[1];
      } else {
        console.error('queryString 不是一个字符串:', queryString);
        cmdString = '';
        cmdArgString = '';
      }
    } else if (requestBotType === 'Completion' || requestBotType === 'Workflow') {
      queryString = messages[messages.length - 1].content;
    }
    const stream = data.stream !== undefined ? data.stream : false;
    
    let requestBody;

    if (possibleJson?.inputs) {
      // 如果请求体中已包含 inputs，保持不变
      requestBody = {
        inputs: {
          ...possibleJson.inputs,
          ...(possibleJson.paths && { paths: possibleJson.paths }),
          ...(possibleJson.space && { space: possibleJson.space }),
        },
        response_mode: "streaming",
        conversation_id: "",
        user: "apiuser",
        auto_generate_name: false,
        query: queryString
      };
    } else if (data.inputs) {
      // 如果有 data.inputs，保持不变
      requestBody = {
        inputs: data.inputs,
        response_mode: "streaming",
        conversation_id: "",
        user: "apiuser",
        auto_generate_name: false
      };
    } else if (inputVariable) {
      // 如果没有 inputs 但有 inputVariable，使用现有逻辑
      requestBody = {
        inputs: {
          [inputVariable]: queryString,
          ...(possibleJson.paths && { paths: possibleJson.paths }),
          ...(possibleJson.space && { space: possibleJson.space }),
        },
        response_mode: "streaming",
        conversation_id: "",
        user: "apiuser",
        auto_generate_name: false
      };
    } else {
      // 修改这部分逻辑
      const historyMessages = messages.filter(message => message.role !== 'system');
      const formattedHistory = historyMessages.map(msg => `${msg.role}: ${msg.content}`).join('\n');
      const lastUserMessage = messages.filter(message => message.role === 'user').pop();

      requestBody = {
        inputs: {
          ...(cmdString && { cmd: cmdString }),
          ...(cmdArgString && { arg: cmdArgString }),
          ...(possibleJson?.paths && { paths: possibleJson.paths }),
          ...(possibleJson?.space && { space: possibleJson.space }),
        },
        query: `以下三个反引号内是历史对话,不需回答,仅供参考:\n\n\`\`\`\n${formattedHistory}\n\`\`\`\n\n用户最新输入,需要回应: ${lastUserMessage ? lastUserMessage.content : ''}`,
        response_mode: "streaming",
        conversation_id: "",
        user: "apiuser",
        auto_generate_name: false
      };
    }

    const resp = await fetch(process.env.DIFY_API_URL + apiPath, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    let isResponseEnded = false;

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      const stream = resp.body;
      let buffer = "";
      let isFirstChunk = true;
      let hasReceivedTextChunk = false;  // 新增变量，用于跟踪是否接收过 text_chunk

      stream.on("data", (chunk) => {
        //console.log("接收到的Chunk:", chunk.toString().slice(0, 60));
        buffer += chunk.toString();
        const lines = buffer.split("\n");

        for (let i = 0; i < lines.length - 1; i++) {
          let line = lines[i].trim();

          if (!line.startsWith("data:")) continue;
          line = line.slice(5).trim();
          let chunkObj;
          try {
            if (line.startsWith("{")) {
              chunkObj = JSON.parse(line);
            } else {
              continue;
            }
          } catch (error) {
            console.error("解析块时出错:", error);
            continue;
          }

          if (chunkObj.event === "node_started") {
            console.log("节点开始执行:", chunkObj.data.title); // 添加日志
          }
          else if (chunkObj.event !== "message") {
            //console.log("接收到的事件:", chunkObj.event); // 添加日志
          }

          if (chunkObj.event === "message" || chunkObj.event === "agent_message" || chunkObj.event === "text_chunk") {
            let chunkContent;
            if (chunkObj.event === "text_chunk") {
              chunkContent = chunkObj.data.text;
              hasReceivedTextChunk = true;  // 标记已接收到 text_chunk
            } else {
              chunkContent = chunkObj.answer;
            }

            if (isFirstChunk) {
              isFirstChunk = false;
            }
            if (chunkContent !== "") {
              const openAIFormatChunk = {
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: data.model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: chunkContent,
                    },
                    finish_reason: null,
                  },
                ],
              };
              
              const responseChunk = JSON.stringify(openAIFormatChunk);
              //console.log("发送的响应块:", responseChunk);
              
              if (!isResponseEnded) {
                res.write(`data: ${responseChunk}\n\n`);
                hasReceivedTextChunk = true;
              }
            }
          } else if (chunkObj.event === "workflow_finished" || chunkObj.event === "message_end") {
            console.log("运行结束消息:", chunkObj.event, "收到过chunk？", hasReceivedTextChunk);
            if (!isResponseEnded) {
              // 只有在没有接收过 text_chunk 时才发送 workflow 输出
              if (chunkObj.event === "workflow_finished" && !hasReceivedTextChunk) {
                const output = chunkObj.data?.outputs?.output ?? chunkObj.data?.outputs?.result ?? chunkObj.data?.outputs?.answer;
                console.log("原始输出:", output); // 添加调试日志

                let finalOutput;
                if (output !== undefined && output !== null) {
                  try {
                    finalOutput = typeof output === 'string' && output.startsWith('{') ? JSON.parse(output) : output;
                  } catch (error) {
                    console.error(`JSON 解析错误 for ${output}:`, error);
                    finalOutput = { output: output }; // 如果解析失败，使用原始输出
                  }
                } else {
                  finalOutput = { output: "" };
                }

                console.log("解析后的 finalOutput:", finalOutput); // 添加调试日志

                const content = finalOutput.output?.result ?? finalOutput.output ?? finalOutput.result ?? finalOutput.text ?? JSON.stringify(finalOutput);
                console.log("选择的内容:", content); // 添加调试日志

                const chunkId = `chatcmpl-${Date.now()}`;
                const chunkCreated = chunkObj.created_at;
                
                const responseChunk = JSON.stringify({
                  id: chunkId,
                  object: "chat.completion.chunk",
                  created: chunkCreated,
                  model: data.model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        content: content.result ?? content, // 确保这里使用处理后的 content
                      },
                      finish_reason: null,
                    },
                  ],
                });

                console.log("发送的响应块:", responseChunk); // 添加调试日志

                res.write(`data: ${responseChunk}\n\n`);
              }

              const chunkId = `chatcmpl-${Date.now()}`;
              const chunkCreated = chunkObj.created_at;
              res.write(
                `data: ${JSON.stringify({
                    id: chunkId,
                    object: "chat.completion.chunk",
                    created: chunkCreated,
                    model: data.model,
                    choices: [
                      {
                        index: 0,
                        delta: {},
                        finish_reason: "stop",
                      },
                    ],
                  })}\n\n`
              );
            }
            if (!isResponseEnded) {
              res.write("data: [DONE]\n\n");
            }

            res.end();
            isResponseEnded = true;
          } else if (chunkObj.event === "agent_thought") {
          } else if (chunkObj.event === "ping") {
          } else if (chunkObj.event === "error") {
            console.error(`Error: ${chunkObj.code}, ${chunkObj.message}`);
            res
              .status(500)
              .write(
                `data: ${JSON.stringify({ error: chunkObj.message })}\n\n`
              );
              
            if (!isResponseEnded) {
            res.write("data: [DONE]\n\n");
            }

            res.end();
            isResponseEnded = true;
          }
        }

        buffer = lines[lines.length - 1];
      });
    } else {
      let result = "";
      let usageData = "";
      let hasError = false;
      let messageEnded = false;
      let buffer = "";
      let skipWorkflowFinished = false;


      const stream = resp.body;
      stream.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (line === "") continue;
          let chunkObj;
          try {
            const cleanedLine = line.replace(/^data: /, "").trim();
            if (cleanedLine.startsWith("{") && cleanedLine.endsWith("}")) {
              chunkObj = JSON.parse(cleanedLine);
            } else {
              continue;
            }
          } catch (error) {
            console.error("Error parsing JSON:", error);
            continue;
          }

          if (
            chunkObj.event === "message" ||
            chunkObj.event === "agent_message"
          ) {
            result += chunkObj.answer;
            skipWorkflowFinished = true;
          } else if (chunkObj.event === "message_end") {
            messageEnded = true;
            usageData = {
              prompt_tokens: chunkObj.metadata.usage.prompt_tokens || 100,
              completion_tokens:
                chunkObj.metadata.usage.completion_tokens || 10,
              total_tokens: chunkObj.metadata.usage.total_tokens || 110,
            };
          } else if (chunkObj.event === "workflow_finished" && !skipWorkflowFinished) {
            messageEnded = true;
            const outputs = chunkObj.data.outputs;
            if (outputVariable) {
              result = outputs[outputVariable];
            } else {
              // 如果 outputVariable 未定义，我们需要正确处理 outputs 对象
              if (typeof outputs === 'object' && outputs !== null) {
                result = JSON.stringify(outputs);
              } else {
                result = String(outputs);
              }
            }
            result = String(result);
            usageData = {
              prompt_tokens: chunkObj.metadata?.usage?.prompt_tokens || 100,
              completion_tokens: chunkObj.metadata?.usage?.completion_tokens || 10,
              total_tokens: chunkObj.data.total_tokens || 110,
            };
          } else if (chunkObj.event === "agent_thought") {
          } else if (chunkObj.event === "ping") {
          } else if (chunkObj.event === "error") {
            console.error(`Error: ${chunkObj.code}, ${chunkObj.message}`);
            hasError = true;
            break;
          } 
        }

        buffer = lines[lines.length - 1];
      });

      stream.on("end", () => {
        if (hasError) {
          res
            .status(500)
            .json({ error: "An error occurred while processing the request." });
        } else if (messageEnded) {
          const formattedResponse = {
            id: `chatcmpl-${generateId()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: data.model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: result.trim(),
                },
                logprobs: null,
                finish_reason: "stop",
              },
            ],
            usage: usageData,
            system_fingerprint: "fp_2f57f81c11",
          };
          const jsonResponse = JSON.stringify(formattedResponse, null, 2);
          res.set("Content-Type", "application/json");
          res.send(jsonResponse);
        } else {
          console.error("诊断信息: 意外的流结束");
          console.error("缓冲区内容:", buffer);
          console.error("结果:", result);
          console.error("消息是否结束:", messageEnded);
          console.error("使用数据:", usageData);
          
          res.status(500).json({ 
            error: "Unexpected end of stream.", 
            diagnostics: {
              buffer: buffer,
              result: result,
              messageEnded: messageEnded,
              usageData: usageData
            }
          });
        }
      });
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "处理请求时发生错误。" });
  }
});

app.listen(process.env.PORT || 3000);