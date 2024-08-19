#!/bin/bash

# 设置变量
API_URL="http://$HOST:$PORT"  # 请根据您的实际部署地址修改
API_KEY="your_api_key_here"      # 请替换为您的实际 API 密钥

# 测试 /v1/models 端点
echo "测试 /v1/models 端点:"
curl -s -X GET "$API_URL/v1/models" \
  -H "Authorization: Bearer $API_KEY" | jq .

echo -e "\n---\n"

# 测试 /v1/chat/completions 端点 (非流式)
echo "测试 /v1/chat/completions 端点 (非流式):"
curl -s -X POST "$API_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "dify",
    "messages": [{"role": "user", "content": "你好,请介绍一下自己。"}],
    "stream": false
  }' | jq .

echo -e "\n---\n"

# 测试 /v1/chat/completions 端点 (流式)
echo "测试 /v1/chat/completions 端点 (流式):"
curl -N -X POST "$API_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "dify",
    "messages": [{"role": "user", "content": "列举三种常见的编程语言。"}],
    "stream": true
  }'

echo -e "\n---\n"

# 测试使用 wf 参数的请求
echo "测试使用 wf 参数的请求:"
curl -s -X POST "$API_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dify",
    "messages": [{"role": "user", "content": "什么是人工智能?"}],
    "stream": false,
    "wf": "Agent 生成 Agent",
    "bot": "Workflow",
    "inputs": {
      "target": "构建一个本地化的搜索引擎"
    }
  }' | jq .

  curl -s -X POST "$API_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dify",
    "messages": [{"role": "user", "content": "什么是人工智能?"}],
    "stream": true,
    "wf": "Agent 生成 Agent",
    "bot": "Workflow",
    "inputs": {
      "target": "构建一个本地化的搜索引擎"
    }
  }'

curl -s -X POST "$API_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dify",
    "messages": [{"role": "user", "content": "什么是人工智能?"}],
    "stream": true,
    "wf": "测试工作流",
    "bot": "Workflow"
  }'

curl -s -X POST "$API_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dify",
    "messages": [{"role": "user", "content": "什么是人工智能?"}],
    "stream": false,
    "wf": "测试工作流",
    "bot": "Workflow"
  }'

  