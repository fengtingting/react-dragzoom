/**
 * @flow
 */

import React from 'react'
import ReactDOM from 'react-dom'
import Draggable from 'react-draggable'
import DragzoomCanvas from './DragzoomCanvas'
import DragSinglePolygon from './DragSinglePolygon'
import createFieldsStore from './createFieldsStore'
import { getinlinePosition, addEvent, removeEvent } from './utils'

function noop() {}
const uninitialSize = { width: 0, height: 0 }

export type typeSize = 'current' | 'lastSize' | 'initSize' | 'actual'
export type Size = { width: number, height: number }
export type Position={ x: number, y: number, }

type Props = {
  img: string,
  style: HTMLStyleElement,
  onSizeChange: Function,
  onSingleDragStop?: Function,
  onDragStop: Function, //used with points
  onDrag: Function,
  maxZoom: number,
  children: any,
  disabled?: boolean,
  polygonDragDisabled: boolean,
  scaleable?:boolean,
  draggable?:boolean,
}

type State = {
  // size: {[typeSize]: Size},
  currentSize: Size,
  lastSize: Size,
  dragProps: {position: {x: number, y: number, onStart?: ()=>mixed, onDrag?: ()=>mixed}}, // 传入react-draggable的属性
  childDragProps: {position: {x: number, y: number, onStart?: ()=>mixed, onDrag?: ()=>mixed}},
  canDraggable: boolean, // 能否拖动,
  scaleNum: number, // 缩放比例
  showScaleNum: boolean, // 显示缩放比例
  isPolygonDrag: boolean, // 自定义图形是否拖动
  
}

type Point = {
  ['id' | 'key']: string, x: number, y: number, offset: {left: number, top: number}
}

export default class Dragzoom extends React.Component<Props, State> {

  static defaultProps = {
    maxZoom: 2,
    scaleable:true,
    disabled:false,
    draggable:true,
    polygonDragDisabled: true,
    onSizeChange: noop,
    // onSingleDragStop: noop,
    onDragStop: noop,
    onDrag: noop,
  }
  canvasPolygon: any
  drag: HTMLElement | null
  childDrag: HTMLDivElement
  imageElement: HTMLImageElement
  containerSize: Size = { ...uninitialSize } // 父容器的大小
  actualImageSize: Size = { ...uninitialSize } //实际图片大小
  initImageSize: Size = { ...uninitialSize } // 初始化的大小
  initPosition: Position = { x: 0, y: 0 } // 图片初始化的位置
  lastPosition: Position = { x: 0, y: 0 } // 图片上一次位置
  currentPosition: Position = { x: 0, y: 0} // 图片的位置
  lastScale: {mouseX: number, mouseY: number}  // 鼠标移动后在图片中的位置
  refreshScale: {mouseX: number, mouseY: number} // 缩放后在图片中的位置
  controlledPositions: {[string]: Point} = {} // 点位信息
  currentPolygonPath: Array<[number, number]> = [] // 当前自定义图层路径
  currentPolygon: { id: string, path: Array<[number, number]>} = { id: '', path: [] }
  constructor(props: Props) {
    super(props)
    this.state = {
      scaleNum: 1,
      showScaleNum: false,
      currentSize: { ...uninitialSize },
      lastSize : { ...uninitialSize },
      dragProps: { position: { x: 0, y: 0 }, onDrag: this.handleDrag, onStop:this.handleDragStop },
      childDragProps: { position: { x: 0, y: 0 }, onDrag: this.handleChildDrag, onStop:this.handleChildDragStop },
      canDraggable: true,
      isPolygonDrag: false,
    }
  }

  componentWillMount() {
    /* $FlowFixMe */
    document.ondragstart = function () { return false }
    if (!this.props.draggable) {
      this.setState({
        dragProps:{ ...this.state.dragProps, onDrag: ()=>false }
      })
    }
    this.resetAllData()
  }
  
  componentDidMount() {
    if (this.props.scaleable) { // 缩放
      addEvent(this.drag, 'mouseover', this.addMoveEvent)
      addEvent(window, 'resize', this.onContaninerResize)
    }
  }

  componentWillReceiveProps(nextProps: Props) {
    const { img } = this.props
    //切换图片
    if (this.props.img !== nextProps.img) {
      this.resetAllData()
    }
  }

  componentWillUnmount() {
    removeEvent(window, 'resize', this.onContaninerResize)
    this.removeScale()
  }

  addscale = ()=>{
    addEvent(this.drag, 'mouseover', this.addMoveEvent)
    addEvent(window, 'resize', this.onContaninerResize)
  }

  removeScale = ()=>{
    removeEvent(this.drag, 'mouseover', this.addMoveEvent)
    removeEvent(this.drag, 'mousemove', this.bindResize)
    removeEvent(this.drag, 'wheel', this.handleResize)
  }

  addMoveEvent = () => {
    removeEvent(this.drag, 'mouseover', this.addMoveEvent)
    addEvent(this.drag, 'mousemove', this.bindResize, false)
    addEvent(this.drag, 'wheel', this.handleResize)
  }

  bindResize = (e: MouseEvent) => {
    if (this.state.currentSize.width <= 0) {
      return
    }
    // 存储鼠标在元素内的位置
    const mouseX = e.pageX
    const mouseY = e.pageY
    this.lastScale = { mouseX, mouseY }
    this.refreshScale = { mouseX, mouseY }
  }

  /**
   * 重置所有数据，重新初始化
   */
  resetAllData = () => {
    this.actualImageSize = { ...uninitialSize }
    const currentSize = { ...uninitialSize }
    const lastSize = { ...uninitialSize }
    this.controlledPositions = {}
    this.setState({ currentSize, lastSize })
  }
  
  /**
   * 重置图片位置，重新获取大小
   */
  onContaninerResize = () => {
    const isupdate = this.initImage()
    if(isupdate) this.onSizeChange(this.initImageSize, this.initImageSize, this.initPosition)
    // this.props.changePosition(position)
    // this.props.onSizeChange(initSize, newSize, position)
  }

  /** 处理滚轮事件 */
  handleResize = (e: WheelEvent) => {
    if (e instanceof WheelEvent) {
      e.preventDefault()
    }
    const { width: actualWidth, height: actualHeight } = this.actualImageSize
    const { onSizeChange, maxZoom } = this.props
    const { currentSize, scaleNum, isPolygonDrag } = this.state
    const { dragProps } = this.state

    if (actualWidth <= 0 || isPolygonDrag) {
      return
    }
    const scaling = e.deltaY < 0 ? 1.25 : 0.8

    // 当前元素大小
    const lastSize = { ...currentSize }
    // 真实图片大小

    // 鼠标在x,y轴中占得比例
    let { mouseX, mouseY } = this.lastScale // 鼠标移动后在图片中的位置
    const { mouseX: lastX, mouseY: lastY } = this.refreshScale  // 缩放后在图片中的位置
    if (mouseX === lastX && mouseY === lastY) { // 鼠标位置已经移动
      const { left, top } = getinlinePosition(this.drag)
      const { x, y } = dragProps.position  // 图片相对于容器的位置
      mouseX = mouseX - left - x
      mouseY = mouseY - top - y
      mouseX = mouseX > 0 ? mouseX : 0
      mouseY = mouseY > 0 ? mouseY : 0
    } else {
      mouseX = lastX
      mouseY = lastY
    }

    const scaleX = mouseX / lastSize.width
    const scaleY = mouseY / lastSize.height

    // 变化后的大小
    let newSize = {
      width: scaling * lastSize.width,
      height: scaling * lastSize.height,
    }

    const minScale = this.initImageSize.width / actualWidth
    // 超出最大倍数则取消
    if ((scaleNum >= maxZoom && scaling > 1) || (scaleNum <= minScale && scaling < 1)) {
      return
    }
    const newScaleNum = this.calculateScale(newSize.width, maxZoom, actualWidth)

    newSize = { width: actualWidth * newScaleNum, height: actualHeight * newScaleNum }

    // 计算减少或增加的高宽
    const scaleSize = {
      width: newSize.width - lastSize.width,
      height: newSize.height - lastSize.height,
    }

    let { position } = dragProps
    if (!position) {
      position = { x: 0, y: 0 }
    }
    const { x, y } = position

    // 计算每次改变大小后所需改变的位置
    position = {
      x: x - scaleSize.width * scaleX,
      y: y - scaleSize.height * scaleY,
    }

    const lastPosition = { ...position }

    // 容器的宽高
    const initWidth = this.containerSize.width
    const initHeight = this.containerSize.height

    // 如果宽高小于父容器的话  就居中
    // 如果宽高大于父容器  但是元素边界在父元素内，则将那边的边界移动到父元素边界
    // ``````
    if (newSize.width <= initWidth) {
      position.x = (initWidth - newSize.width) / 2
    } else if (position.x > 0) {
      position.x = 0
    } else if (position.x < -(newSize.width - initWidth)) {
      position.x = -(newSize.width - initWidth)
    }

    if (newSize.height <= initHeight) {
      position.y = (initHeight - newSize.height) / 2
    } else if (position.y > 0) {
      position.y = 0
    } else if (position.y < -(newSize.height - initHeight)) {
      position.y = -(newSize.height - initHeight)
    }

    const offsetX = lastPosition.x - position.x
    const offsetY = lastPosition.y - position.y

    let canDraggable = false
    if ((offsetX === 0 || offsetY === 0) && scaleNum !== minScale) {
      canDraggable = true
    }
    // 重新计算鼠标在元素内的位置
    this.refreshScale = { mouseX: newSize.width * scaleX + offsetX, mouseY: newSize.height * scaleY + offsetY }

    dragProps.position = position

    if (newSize.height <= 462 && newSize.width <= 842) {
        // dragProps={...dragProps,onStart:()=>false}
    } else if (dragProps.onStart) {
      delete dragProps.onStart
    }
    // ``````
    this.onSizeChange(this.initImageSize, newSize, position)
    this.setState({ currentSize: newSize, lastSize: newSize ,dragProps, canDraggable, scaleNum: newScaleNum, showScaleNum: true })
    setTimeout(() => this.setState({ showScaleNum: false }), 500)
  }

  /**
   * 大小变化，所有对应的点位 位置都要改变
   * @param position 图片的位置
   * currentPosition 初始时为上一次图片的位置
   */
  onSizeChange = (initSize: Size, newSize: Size, position: Position) => {
    const { currentPosition, controlledPositions } = this
    const lastPositin = currentPosition
    const { width, height } = newSize
    const { lastSize } = this.state
    const positions = Object.keys(controlledPositions)
    if (positions.length > 0) {
      positions.map(id => {
        // 重新进行偏移，将偏移量加回
        let { x: lastX, y: lastY, offset } = controlledPositions[id]
        const { left = 0, top = 0 } = offset
        lastX += left
        lastY += top
        const scaleX = (lastX - lastPositin.x) / lastSize.width
        const scaleY = (lastY - lastPositin.y) / lastSize.height
        const newX = width * scaleX + position.x
        const newY = height * scaleY + position.y
        const newPosition = { x: newX - left, y: newY - top }
        controlledPositions[id] = { ...controlledPositions[id], ...newPosition }
      })
    }
    this.currentPosition = position
    this.setState({currentSize: newSize, lastSize: newSize})
    this.props.onSizeChange(newSize)
  }

  /** 计算图片的缩放值 */
  calculateScale = (width: number, max: number, actualWidth: number, min: number = 0, init: number = 0.33) => {
    const value = Number((width / actualWidth).toFixed(2))
    if (Math.abs(value - max) * 100 < 10 || value > max) { // 最大值
      return max
    }
    if (Math.abs(value - 1) * 100 < 10) { // 图片为100%时候的值
      return 1
    }
    if (min === 0) {
      const { initImageSize } = this
      min = initImageSize.width / actualWidth
    }
    return value < min ? min : value
  }
  
  /** 
   * 初始化图片位置跟改变图片位置,父容器大小变化的时候调用, 获取图片跟点位位置
   * @param position 图片的最新位置
   * sclakX,sclaKY 为 图片距离上次移动的距离
   * @tooltip 图片位置为发生更改时也会执行，需要修改
   */
  changePosition = (position: {x: number, y: number}) => {
    const { currentPosition, controlledPositions } = this
    const positions = Object.keys(controlledPositions)
    const sclakX = position.x - currentPosition.x
    const sclakY = position.y - currentPosition.y
    positions.map((item) => {
      const { x, y, id } = controlledPositions[item]
      controlledPositions[id] = { ...controlledPositions[item], x: x + sclakX, y: y + sclakY }
    })
    this.currentPosition = position
    this.setState({})
  }

  /** 重置图片 */
  initImage = (actualSize: Size = this.actualImageSize) => {
    const { dragProps, currentSize } = this.state
    const node = ReactDOM.findDOMNode(this.drag)
    if (!node || !(node instanceof HTMLElement)) {
      return false
    }
    const offsetParent: any = this.props.offsetParent || node.offsetParent || node.ownerDocument.body
    if (
      this.containerSize.width === offsetParent.clientWidth &&
      this.containerSize.height === offsetParent.clientHeight &&
      JSON.stringify(currentSize) !== JSON.stringify(uninitialSize)
    ) {
      return false
    }
    this.containerSize = { width: offsetParent.clientWidth || 10, height: offsetParent.clientHeight || 10 }
    // 真实图片的大小
    const { width: actualWidth, height: actualHeight } = actualSize
    let scaleNum, size = {}
    // 如果图片超出父容器
    if (actualWidth > this.containerSize.width || actualHeight > this.containerSize.height) {
      const scaleWidth = actualWidth / this.containerSize.width
      const scaleHeight = actualHeight / this.containerSize.height
      const scaleMax = Math.max(scaleWidth, scaleHeight)
      size.width = actualWidth / scaleMax
      size.height = actualHeight / scaleMax
      scaleNum = this.calculateScale(size.width, 2, actualWidth, this.initImageSize.width / actualWidth)
      // 重置初始大小，将当前大小变成初始大小
    } else {
      size = { ...actualSize }
      scaleNum = 1
    }
    this.initImageSize = { ...size }
    // 元素的初始位置
    this.initPosition = {
      x: (this.containerSize.width - size.width) / 2,
      y: (this.containerSize.height - size.height) / 2,
    }
    // this.currentPosition = {...this.initPosition}
    dragProps.position = { ...this.initPosition }
    const newState = {
      dragProps,
      currentSize: { ...size },
      lastSize: { ...size },
      scaleNum,
      canDraggable: false
    }
    if (this.state.lastSize && this.state.lastSize.width !== 0) delete newState.lastSize
    this.setState(newState)
    return true
  }

  /**
   * 重置图片跟点位位置
   * @param actualSize 图片真实大小
   * @return initSize newSize position --在父元素中的初始位置, 其中initSize = newSize
   */
  init = (actualSize: Size = this.actualImageSize) => {
    const isupdate = this.initImage()
    // 获取图片在屏幕中的位置
    // this.containerPosition = getinlinePosition(this.drag)
    if(isupdate) this.changePosition(this.initPosition)
  }
  
  imageOnLoad = (e: Event) => {
    const { target } = e
    if (target instanceof HTMLImageElement) {
      const { naturalWidth, naturalHeight } = target
      const actualSize = { width: naturalWidth, height: naturalHeight }
      this.actualImageSize = actualSize
      this.init()
    }
  }

  /** 开始容器拖拽, 同时改变上面的点， 此时不能停止更新 */
  handleDrag = (e: Event, ui: Object) => {
    if (this.actualImageSize.width <= 0) {
      return
    }
    const { currentSize, dragProps } = this.state
    const { x, y, deltaX, deltaY } = ui
    let left = x, top = y, position
    this.changePosition({x,y})
    const initWidth = this.containerSize.width
    const initHeight = this.containerSize.height

    // 拖动块的宽高跟parent宽高的差值,
    /** TODO:下面的函数纯粹为了dragstop的时候可以有重置的位置，可以改成非state */
    const width = currentSize.width - initWidth
    const height = currentSize.height - initHeight
    if (currentSize.width > initWidth) { // x超出父元素
      if (x >= 0) { left = 0 }
      if (x < -width) { left = -width }
    } else { left = (initWidth - currentSize.width) / 2 }

    if (currentSize.height > initHeight) { // y超出父元素
      if (y >= 0) { top = 0 }
      if (y < -height) { top = -height }
    } else { top = (initHeight - currentSize.height) / 2 }
    dragProps.position = { x: left, y: top }
    this.setState({ dragProps })
  }

  /** 容器拖拽停止 */
  handleDragStop = () => {
    const { position } = this.state.dragProps
    this.changePosition(position)
  }

  /**
   * 进行点位的坐标偏移，点位初始化时需要进行偏移操作，往后操作的都是偏移后的点，
   * 进行缩放时，减去的偏移量需要重新加回后进行计算
   */
  shiftPoint = (point: Point): Point => {
    const { offset = { left: 0, top: 0 } } = point
    const x = point.x - offset.left
    const y = point.y - offset.top
    return { ...point, x, y, offset }
  }
  
  /** 转换成虚拟坐标 */
  calculateAllPosition = (position: Array<[number, number]>, currentPosition: Position = this.currentPosition) => {
    const {x, y} = currentPosition
    const scale = this.state.currentSize.width / this.actualImageSize.width
    return position.map(([pointX, pointY]) => [pointX*scale+x, pointY*scale+y])
  }

  /** 转换成真实坐标 */
  getAllActualPosition = (position: Array<[number, number]>) => {
    const { currentPosition: {x ,y} } = this
    // let { position: { x:newX, y:newY } } = this.state.childDragProps
    const scale = this.state.currentSize.width / this.actualImageSize.width
    return position.map(([pointX, pointY]) => [(pointX-x)/scale, (pointY-y)/scale])
  }

  /**
   * 传入未经计算过的点位信息，返回相对于拖动层的图片位置,带偏移量的点需要进行偏移校正
   * @param point 点位信息
   */
  calculatePosition = (point: Point): Point => {
    const { currentPosition } = this
    const { x, y, offset } = this.shiftPoint(point)
    // 当前点位距离图片的长宽（位置）
    const width = point.x
    const height = point.y
    // 图片压缩或者放大后的比例
    const scale = this.state.currentSize.width / this.actualImageSize.width
    const newWidth = width * scale
    const newHeight = height * scale

    const newX = newWidth + currentPosition.x - offset.left
    const newY = newHeight + currentPosition.y - offset.top

    return ({ ...point, x: newX, y: newY })
  }

  /**
   * 获取到点位的真实坐标
   * @param point 点位信息
   */
  getActualPosition = (point: Point) => {
    const { currentPosition, actualImageSize } = this
    const { currentSize } = this.state
    const { x, y, id, offset } = point
    const width = x - currentPosition.x + offset.left
    const height = y - currentPosition.y + offset.top
    const scale = actualImageSize.width / currentSize.width
    const newWidth = width * scale
    const newHeight = height * scale
    return ({ x: Number(newWidth.toFixed(2)), y: Number(newHeight.toFixed(2)), id })
  }

  getChildPosition = (id: string, childProps: Object) => {
    const { currentPosition, controlledPositions } = this
    const { position, offset } = childProps
    if (!controlledPositions[id]) {
      controlledPositions[id] = this.calculatePosition({...position, offset})
      controlledPositions[id].id = id
    }
    return controlledPositions[id]
  }
  
  /**
   * 获取边界值
   */
  getboundPosition = (id:string) => {
    let outBound = false
    const { currentPosition, controlledPositions } = this
    // const { x, y } = position
    const { width, height } = this.state.currentSize
    const { x: parentX, y: parentY } = currentPosition
    let { x, y, offset: { top, left } } = controlledPositions[id]
    const bounds = { top: parentY - top, left: parentX - left, right: parentX + width - left, bottom: parentY + height - top }
    if(x> bounds.right || x <bounds.left){
      x = x> bounds.right? bounds.right : bounds.left
      outBound = true
    }
    if(y> bounds.bottom || y <bounds.top){
      y = y> bounds.bottom? bounds.bottom : bounds.top
      outBound = true
    }
    if(outBound){
      controlledPositions[id] = { ...controlledPositions[id], x, y }
      this.setState({})
    }
  }

  /**
   * 控制点位的拖动
   * @param id 点位的key(唯一标识符)
   * @param postition 点位的位置
   */
  onControlledDrag = (id: string, position: Position) => {
    const { controlledPositions } = this
    controlledPositions[id] = { ...controlledPositions[id], ...position }
    this.setState({ })
  }

  /**
   * 控制单个点位移动结束后执行
   * @param {*} position 点位的位置
   */
  onSingleControlledDragStop = (id: string) => {
    const { onSingleDragStop } = this.props
    this.getboundPosition(id)
    if (!onSingleDragStop) {
      return
    }
    const newPoint = this.getActualPosition(this.controlledPositions[id])
    onSingleDragStop(newPoint)
  }

  /**
   * 控制点位移动结束后执行
   * @param {*} position 点位的位置
   */
  onControlledDragStop = (id: string, position: Position) => {
    const { onDragStop, disabled } = this.props
    if (disabled) { return }
    this.onSingleControlledDragStop(id)
    if (!onDragStop) {
      return
    }
    // this.onControlledDrag(e, position)
    const { controlledPositions } = this
    const positionsKey = Object.keys(controlledPositions)
    const positions = positionsKey.map(id =>
      this.getActualPosition(controlledPositions[id]),
    )
    onDragStop(positions)
  }

  /** 自定义图层拖拽 */
  handleChildDrag = (e: Event, ui: Object) => {
    if (this.actualImageSize.width <= 0) return
    const { childDragProps } = this.state
    const { x, y } = ui
    childDragProps.position = { x, y }
    this.setState({ childDragProps })
  }

  /** 自定义图层拖动停止 */
  handleChildDragStop = (e: Event, ui: Object) => {
    const path = this.getAllActualPosition(this.currentPolygonPath)
    this.currentPolygon.path = path
    this.onPolygonDragStop()
  }

  /** 自定义图层拖动开始 path为真实路径 */
  onPolygonDragStart = (id: string, path: Array<[number, number]>, e: MouseEvent) => {
    const { childDragProps } = this.state
    childDragProps.position = {...this.currentPosition}
    this.currentPolygon = {id, path}
    this.canvasPolygon.setShouldUpdate(false)
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: e.clientX,
      clientY: e.clientY,
    })
    this.setState({ isPolygonDrag: true, childDragProps }, () => this.childDrag.dispatchEvent(event))
    
    
  }

  onPolygonDragStop = () => {
    this.canvasPolygon.setShouldUpdate(true)
    this.setState({ isPolygonDrag: false }, () => this.currentPolygon = { id: '', path: []} )
    this.currentPolygonPath = []
  }

  savePolygonPath = (path: Array<[number, number]>) => {
    this.currentPolygonPath = path
  }

  renderDragCanvasPolygon = (child: any) => {
    const { width, height } = this.state.currentSize
    if (width === 0 || height === 0) { return }
    if (child.type.isDragCanvasPolygon) {
      const canvasProps = {
        containerSize: this.containerSize,
        currentPosition: this.state.childDragProps.position,
        calculateAllPosition: this.calculateAllPosition,
        ...this.currentPolygon,
        savePolygonPath: this.savePolygonPath,
      }
      return <DragSinglePolygon {...canvasProps} />
    }
  }

  renderCanvasPolygon = (child: any) => {
    const { width, height } = this.state.currentSize
    if (width === 0 || height === 0) { return }
    if (child.type.isDragCanvasPolygon) {
      const path = this.currentPolygonPath
      let canvasProps = {
        currentSize: this.state.currentSize,
        actualImageSize: this.actualImageSize,
        containerSize: this.containerSize,
        currentPosition: this.currentPosition,
        calculateAllPosition: this.calculateAllPosition,
        onPolygonDragStart: this.onPolygonDragStart,
        getAllActualPosition: this.getAllActualPosition,
        // isCurrentPolygon: child.props.id === this.currentPolygon.id,
        ref: (rn: any) => this.canvasPolygon = rn
      }
      if(!this.state.isPolygonDrag) {
        canvasProps = { ...canvasProps, ...this.currentPolygon }
      }
      return React.cloneElement(child, canvasProps)
    }
  }

  renderCommonItem = (child: any) => {
    const { width, height } = this.state.currentSize
    if (width === 0 || height === 0) { return }
    if (child.type.isDragItems) {
      const childProps = {
        onControlledDrag: this.onControlledDrag,
        onControlledDragStop: this.onControlledDragStop,
      }
      return React.cloneElement(child, {getChildPosition: this.getChildPosition, childProps})
    }
  }

  renderCanvas = () => {
    const { width, height } = this.state.currentSize
    if (width === 0 || height === 0) return
    const canvasProps = {
      imageElement: this.imageElement,
      currentSize: this.state.currentSize,
      actualImageSize: this.actualImageSize,
      containerSize: this.containerSize,
      currentPosition: this.currentPosition,
    }
    return <DragzoomCanvas {...canvasProps} />
  }
  
  render() {
    const { img, polygonDragDisabled } = this.props
    const {
      dragProps,
      canDraggable,
      currentSize: { width, height },
      scaleNum,
      showScaleNum,
      isPolygonDrag,
    } = this.state
    const newStyle = {
      width: `${width}px`,
      height: `${height}px`,
      cursor: canDraggable ? 'move' : 'auto',
    }
    const showScale = (scaleNum * 100).toFixed(0)
    return (
      <div className="dragzoom" id="dragzoom" style={{ position: 'relative', ...this.props.style }}>
        <img ref={(rn: any) => this.imageElement = rn} src={img} onLoad={this.imageOnLoad} style={{display: 'none'}} />
        <div className="drag-wrap" ref={ rn => this.drag = rn} style={{ height: '100%', width: '100%', position: 'relative' }}>
          {this.renderCanvas()}
          {React.Children.map(this.props.children, this.renderCanvasPolygon)}
          {polygonDragDisabled? <Draggable {...dragProps}><div style={newStyle} /></Draggable> :null}
          {isPolygonDrag? React.Children.map(this.props.children, this.renderDragCanvasPolygon) : null}
          <Draggable {...this.state.childDragProps}><div ref={(rn: any) => this.childDrag = rn} style={{...newStyle, display: isPolygonDrag? 'block':'none'}} /></Draggable>
          {React.Children.map(this.props.children, this.renderCommonItem)}
          {showScaleNum ? <span className="scaleNum">{`${showScale}%`}</span> : null}
        </div>
      </div>
    )
  }
}
