/**
 * 从字符串中提取可能的JSON对象
 * @param {string} str 输入字符串
 * @returns {{possibleJson: object|null, remainingString: string}} 返回可能的JSON对象和剩余字符串
 */
export function extractPossibleJson(str) {
    let possibleJson = null;
    let remainingString = str;

    // 查找第一个左花括号和最后一个右花括号的位置
    const startIndex = str.indexOf('{');
    const endIndex = str.lastIndexOf('}');

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        const jsonString = str.substring(startIndex, endIndex + 1);
        try {
            possibleJson = JSON.parse(jsonString);
            remainingString = str.slice(0, startIndex) + str.slice(endIndex + 1);
        } catch (error) {
            // JSON解析失败,保持原样
        }
    }

    return { possibleJson, remainingString };
}