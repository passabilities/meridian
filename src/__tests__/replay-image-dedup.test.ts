import {describe, expect, it} from "bun:test"
import {frameStructuredReplay, normalizeStructuredUserContent, coalesceStructuredUserMessages} from "../proxy/replay"

const image = {type:"image",source:{type:"base64",media_type:"image/png",data:"aGlzdG9yaWNhbA=="}}
const entry = (content: unknown) => ({message:{content}})
const imageBlocks = (messages: ReturnType<typeof frameStructuredReplay>) => messages.flatMap(m =>
  Array.isArray(m.message.content) ? m.message.content.filter(b => b?.type === "image") : [])

describe("historical image replay deduplication", () => {
  it("does not amplify one historical payload through three attachment read-back cycles", () => {
    const history = [entry([image])]
    const counts: number[] = []
    for (let round=0; round<3; round++) {
      const outgoing = frameStructuredReplay([...history,entry(`current text ${round}`)])
      const images = imageBlocks(outgoing)
      counts.push(images.length)
      history.push(entry(normalizeStructuredUserContent([{type:"tool_result",tool_use_id:`read-${round}`,content:[{type:"text",text:`read-back ${round}`},...images]}])))
    }
    expect(counts).toEqual([1,1,1])
    const rendered = JSON.stringify(frameStructuredReplay([...history,entry("final text")]))
    for(let round=0;round<3;round++) {
      expect(rendered).toContain(`read-${round}`)
      expect(rendered).toContain(`read-back ${round}`)
    }
    expect(rendered).toContain("Earlier replayed turns contain 4 images")
  })

  it("preserves distinct historical bytes and all current media, even matching bytes", () => {
    const distinct = {...image,source:{...image.source,data:"ZGlzdGluY3Q="}}
    const current = structuredClone(image)
    const source = [entry([image,image,distinct]),entry([current,current])]
    const before = structuredClone(source)
    expect(imageBlocks(frameStructuredReplay(source))).toEqual([image,distinct,current,current])
    expect(source).toEqual(before)
  })

  it("compares valid base64 bytes, retaining URLs, malformed sources and distinct MIME types", () => {
    const unpadded = {...image,source:{...image.source,data:image.source.data.replace(/=+$/,"")}}
    const jpeg = {...image,source:{...image.source,media_type:"image/jpeg"}}
    const url = {type:"image",source:{type:"url",url:"https://example.invalid/image.png"}}
    const invalid = {...image,source:{...image.source,data:"not!base64"}}
    const source = [entry([image,unpadded,jpeg,url,url,invalid,invalid]),entry("current")]
    expect(imageBlocks(frameStructuredReplay(source))).toEqual([image,jpeg,url,url,invalid,invalid])
  })

  it("does not hide malformed padding behind an otherwise matching valid image", () => {
    const malformed = {...image,source:{...image.source,data:image.source.data.slice(0,-1)}}
    const source=[entry([image,malformed,malformed]),entry("current")]
    expect(imageBlocks(frameStructuredReplay(source))).toEqual([image,malformed,malformed])
  })

  it("also deduplicates history when replay ends in an assistant context turn", () => {
    expect(imageBlocks(frameStructuredReplay([entry([image,image]),entry("[Assistant: prior answer]")],false))).toEqual([image])
  })

  it("leaves native checkpoint results and ordinary resume coalescing unchanged", () => {
    const result=[{type:"tool_result",tool_use_id:"native",content:[image,image]}]
    expect(normalizeStructuredUserContent(result,true)).toEqual(result)
    expect(imageBlocks(coalesceStructuredUserMessages([entry([image]),entry([image])]))).toEqual([image,image])
    expect(frameStructuredReplay([entry([image,image])])).toEqual([entry([image,image])])
  })
})
