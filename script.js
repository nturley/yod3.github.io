// Deserialize json data, make it usable for d3
// by the end of it, we have inputPorts, outputPorts, and cells.
// all of which will conform to the same interface



// converts an associative array to an indexed array
// embeds key as a member named "key"
function toArray(assoc)
{
    var map = d3.map(assoc)
    map.forEach(function (k, v){v.key=k});
    return map.values();
}
// returns an array of ports that are going a specific direction
// the elements in this array are obects whose members are key and value
// where key is the port name and value is the connection array

function getCellPortList(cell, direction)
{
    return d3.map(cell.connections).entries().filter(function(d)
    {
        return cell.port_directions[d.key] == direction;
    });
}

//-------------------------------------------------------------------
// flatten data
ports = toArray(diagram.modules.up3down5.ports);
var inputPorts = ports.filter(function(d){return d.direction=='input'});
var outputPorts = ports.filter(function(d){return d.direction=='output'});
var cells = toArray(diagram.modules.up3down5.cells);
cells.forEach(function(c)
{
    c.inputPorts = getCellPortList(c,"input");
    c.outputPorts = getCellPortList(c,"output");
});
inputPorts.forEach(function(p)
{
    p.inputPorts = [];
    p.outputPorts = [{'key':p.key,'value':p.bits}];
});
outputPorts.forEach(function(p)
{
    p.inputPorts = [{'key':p.key,'value':p.bits}];
    p.outputPorts = [];
});


// now we have three variables: inputPorts, outputPorts, and cells
// all three conform to [{inputPorts:[{key:k,value:v}],outputPorts:[{key:k,value:v}]}]

nodes = cells.concat(inputPorts).concat(outputPorts);

function addConstants(nodes, cells)
{
    // find the maximum signal number
    var maxNum=-1;
    nodes.forEach(function(n)
    {
        n.outputPorts.forEach(function(p) {
        maxNum = d3.max([maxNum,d3.max(p.value)])
        });
    });

    // add constants to cells
    nodes.forEach(function(n)
    {
        n.inputPorts.forEach(function(p)
        {
            name = "";
            constants = [];
            for (var i in p.value) {
                if (p.value[i]<2)
                {
                    maxNum += 1;
                    name+=p.value[i];
                    p.value[i] = maxNum;
                    constants.push(maxNum);
                }
                else if (constants.length>0)
                {
                    cells.push(
                    {
                      "key": '$constant_'+arrayToBitstring(constants),
                      "hide_name": 1,
                      "type": name,
                      "inputPorts":[],
                      "outputPorts":[{'key':'Y','value':constants}]
                    });
                    name='';
                    constants = [];
                }
            }
            if (constants.length>0)
            {
                cells.push(
                {
                    "key": '$constant_'+arrayToBitstring(constants),
                    "hide_name": 1,
                    "type": name,
                    "inputPorts":[],
                    "outputPorts":[{'key':'Y','value':constants}]
                });
            }
        });
    });
}
addConstants(nodes, cells);
//refresh nodes
nodes = cells.concat(inputPorts).concat(outputPorts);
// --------------------------------------------------
// solve splits and joins

allInputs = [];
allOutputs = [];
nodes.forEach(function(n) 
{
    n.inputPorts.forEach(function(i)
    {
        allInputs.push(','+i.value.join()+',');
    });
    n.outputPorts.forEach(function(i)
    {
        allOutputs.push(','+i.value.join()+',');
    });
});

allInputsCopy = allInputs.slice();
var splits = {};
var joins = {};
for (var i in allInputs) {
    gather(allOutputs, allInputsCopy, allInputs[i], 0, allInputs[i].length, splits, joins);
}

for (var join in joins) {
    signals = join.slice(1,-1).split(',');
    for (var i in signals) {
      signals[i] = Number(signals[i])
    }
    outPorts = [{'key':'Y','value':signals}];
    inPorts = [];
    for (var i in joins[join]) {
        var name = joins[join][i];
        var value = getBits(signals, name);
      inPorts.push({'key':name,'value':value});
    }
    cells.push({"key":'$join$'+join,
      "hide_name": 1,
      "type": "$_join_",
      "inputPorts":inPorts,
      "outputPorts":outPorts});
}

for (var split in splits) {
    signals = split.slice(1,-1).split(',');
    for (var i in signals) {
      signals[i] = Number(signals[i])
    }
    inPorts = [{'key':'A','value':signals}];
    outPorts = [];
    for (var i in splits[split]) {
        var name = splits[split][i];
        var value = getBits(signals, name);
      outPorts.push({'key':name,'value':value});
    }
    cells.push({"key":'$split$'+split,
      "hide_name": 1,
      "type": "$_split_",
      "inputPorts":inPorts,
      "outputPorts":outPorts});
}
//refresh nodes
nodes = cells.concat(inputPorts).concat(outputPorts);

// At this point, only perfect matches should exist

// also give each port a reference to it's parent (parentNode)
// collect all ports driven by a net
nets= {}
nodes.forEach(function(n) 
{
    var nodeName = n.key;
    for (var i in n.inputPorts)
    {
        var port = n.inputPorts[i];
        port.parentNode = n;
        addToDefaultDict(nets,arrayToBitstring(port.value),port);
    }
});
// build a list of wire objects that hold references to the ports the net connects to
wires = [];
nodes.forEach(function(n) 
{
    var nodeName = n.key;
    for (var i in n.outputPorts)
    {
        var port = n.outputPorts[i];
        port.parentNode = n;
        riders = nets[arrayToBitstring(port.value)];
        var wire = {'driver':port,'riders':riders};
        wires.push(wire);
        port.wire = wire;
        riders.forEach(function(r)
        {
            r.driver=port;
        });
    }
});

// find all root nodes (only inputs)
var rootNodes = nodes.filter(function(d) {
    return d.inputPorts.length == 0;
});

var leafNodes = nodes.filter(function(d) {
    return d.outputPorts.length == 0;
});


// DFS to detect cycles
function visitDependents(n, visited)
{
    visited[n.key] = true;
    n.outputPorts.forEach(function(p)
    {
        p.wire.riders.forEach(function(r)
        {
            if (!(r.parentNode.key in visited))
            {
                visitDependents(r.parentNode, visited);
            } 
            else
            {
                if (n.type == '$dff')
                {
                    r.feedback = true;
                }
            }
        });
    });
}

rootNodes.forEach(function(n)
{
    visitDependents(n,{});
});

nodes.forEach(function(n)
{
    n.inputPorts.forEach(function(i)
    {
        if (i.feedback)
        {
            n.outputPorts.push(i);
            var newInputPort = {'parentNode':i.driver.parentNode,'driver':i};
            var wire = {'driver':i,'riders':[newInputPort]};
            wires.push(wire);
            i.wire = wire;
            n.inputPorts = n.inputPorts.filter(function(port){return port!=i;});
            i.driver.parentNode.inputPorts.push(newInputPort);
            i.driver.wire.riders = i.driver.wire.riders.filter(function(port){return port!=i;});
        }
    });
});

// we are now cycle free!
// Do a longest path algo to assign nodes a depth
var greatestRDepth = 0;
function reverseDFS(node, rdepth)
{
    if (node.rdepth==undefined || rdepth>node.rdepth)
    {
        node.rdepth = rdepth;
        if (rdepth>greatestRDepth)
            greatestRDepth=rdepth;
        node.inputPorts.forEach(function(p)
        {
            reverseDFS(p.driver.parentNode, rdepth+1);
        });
    }
}
leafNodes.forEach(function(n)
{
    reverseDFS(n,0);
});

function DFS(node, depth)
{
    if (node.depth==undefined || depth>node.depth)
    {
        node.depth = depth;
        node.outputPorts.forEach(function(p)
        {
            p.wire.riders.forEach(function(r)
            {
                DFS(r.parentNode, depth+1);
            });
        });
    }
}
rootNodes.forEach(function(n)
{
    DFS(n,greatestRDepth-n.rdepth);
});


function addDummies(driverPort, riderPort, dummies)
{
    var numberOfDummies = riderPort.parentNode.depth - driverPort.parentNode.depth - 1;
    if (numberOfDummies==0)
        return;
    // disconnect
    driverPort.wire.riders = driverPort.wire.riders.filter(function(r){return r!=riderPort;});

    
    var lastDriverPort = driverPort;
    for (var i=0;i<numberOfDummies;i++)
    {
        var dummy = 
        {
            'type':'$_dummy_',
            'inputPorts' : [{'driver':lastDriverPort}],
            'outputPorts': [{'wire':{'riders':[]}}],
            'depth' : driverPort.parentNode.depth+i+1
        }
        dummy.inputPorts[0].parentNode = dummy;
        dummy.outputPorts[0].parentNode = dummy;
        dummy.outputPorts[0].wire.driver = dummy.outputPorts[0];
        lastDriverPort.wire.riders.push(dummy.inputPorts[0]);
        lastDriverPort = dummy.outputPorts[0];
        dummies.push(dummy);
        wires.push(dummy.outputPorts[0].wire);
    }
    lastDriverPort.wire.riders.push(riderPort);
    riderPort.driver = lastDriverPort;
}

var allDummies = [];

nodes.forEach(function(n)
{
    n.inputPorts.forEach(function(i)
    {
        addDummies(i.driver, i, allDummies);
    });
});


nodes = nodes.concat(allDummies);


//-------------------------------------
// create SVG objects for each data object and assign them classes

var viewer = d3.select('#viewer');

var cellViews = viewer.selectAll('.cell')
    .data(cells)
    .enter().append('g')
        .attr('class',function(d)
            {
                var ret = 'cell node generic';
                if (d.type=='$_dummy_')
                {
                    ret+=' dummy';
                }
                return ret;
            });

viewer.selectAll('.dummy')
    .data(allDummies)
    .enter().append('g')
        .attr('class','node dummy')
        .append('line')
            .attr('class','dummyBody')

cellViews.selectAll('.inPort')
        .data(function(cell){return cell.inputPorts;})
        .enter().append('g')
            .attr('class', 'port inport');

cellViews.selectAll('.cell .outPort')
    .data(function(cell){return cell.outputPorts;})
    .enter().append('g')
        .attr('class','port outport');

viewer.selectAll('.inputExt')
    .data(inputPorts)
    .enter().append('g')
        .attr('class','inputExt external node generic')
        .selectAll('.inputExt .port')
            .data(function(ext){return ext.outputPorts;})
            .enter().append('g')
            .attr('class','port outport');
    
viewer.selectAll('.outputExt')
    .data(outputPorts)
    .enter().append('g')
        .attr('class','outputExt external node generic')
        .selectAll('.outputExt .port')
            .data(function(ext){return ext.inputPorts;})
            .enter().append('g')
            .attr('class','port inport')

genericViews = d3.selectAll('.generic');
genericViews.append('rect')
    .attr('class','nodeBody');
genericViews.append('text')
    .attr('class', 'label');

portViews = d3.selectAll('.port');
portViews.append('line')
    .attr('class', 'stem');
portViews.append('circle')
    .attr('class', 'leaf');

wireViews = viewer.selectAll('.net')
    .data(wires)
    .enter().append('g')
        .attr('class', 'net')
        .selectAll('.wire')
            .data(function(d){return d.riders})
            .enter().append('g')
                .attr('class','wire')

wireViews.append('line')
    .attr('class', 'wirestart');
wireViews.append('line')
    .attr('class','wiremiddle');
wireViews.append('line')
    .attr('class','wireend')


//-----------------------------
// Assign all other attributes to each SVG object

// positioning constants
var VIEWER_WIDTH = 1500;
var VIEWER_HEIGHT = 1000;
var EDGE_NODE_GAP = 20;
var NODE_GAP = 80;
var BODY_WIDTH = 40;
var LEAF_DIAMETER = 6;
var LEAF_RADIUS = LEAF_DIAMETER/2;
var STEM_LENGTH = 10;
var EDGE_PORT_GAP = 10;
var PORT_GAP = 20;
var NODE_LABEL_Y = -5;

// helper functions
nodeScale = d3.scale.linear()
    .domain([0,1])
    .range([EDGE_NODE_GAP, EDGE_NODE_GAP + NODE_GAP]);

portScale = d3.scale.linear()
    .domain([0,1])
    .range([EDGE_PORT_GAP, EDGE_PORT_GAP+PORT_GAP]);

function genericHeight (cell)
{
    gaps = d3.max([cell.inputPorts.length, cell.outputPorts.length])-1;
    return gaps*PORT_GAP+2*EDGE_PORT_GAP;
}

// set view model position properties

for (var i in inputPorts)
{
    inputPorts[i].x = 50;
    inputPorts[i].y = nodeScale(i);
}

for (var i in cells)
{
    cells[i].x = 300;
    cells[i].y = nodeScale(i);
}

for (var i in outputPorts)
{
    outputPorts[i].x = 550;
    outputPorts[i].y = nodeScale(i);
}

for (var i in allDummies)
{
    allDummies[i].x = 550;
    allDummies[i].y = nodeScale(i);
}

for (var i in nodes)
{
    var node = nodes[i];
    for (var j in node.inputPorts)
    {
        node.inputPorts[j].x = -BODY_WIDTH/2 - STEM_LENGTH;
        node.inputPorts[j].y = portScale(j);
    }
    for (var j in node.outputPorts)
    {
        node.outputPorts[j].x = BODY_WIDTH/2 + STEM_LENGTH;
        node.outputPorts[j].y = portScale(j);
    }
}

function dragstart(d)
{
    d.fixed = true;
}

function updateNodes()
{
    d3.selectAll('.node')
    .attr('transform',function(d) { return 'translate('+[d.x, d.y-genericHeight(d)/2]+')';})
}

function globalX(p)
{
    return p.x+p.parentNode.x;
}

function globalY(p)
{
    var thing = Number(p.y)+Number(p.parentNode.y)-genericHeight(p.parentNode)/2;
    return thing;
}

function x2(d)
{
    if (globalX(d.driver) < globalX(d))
        return (globalX(d) + globalX(d.driver)) / 2;
    return globalX(d.driver);
}

function y2(d)
{
    if (globalX(d.driver) < globalX(d))
        return globalY(d.driver);
    return (globalY(d) + globalY(d.driver)) / 2;
}

function x3(d)
{
    if (globalX(d.driver) < globalX(d))
        return (globalX(d) + globalX(d.driver)) / 2;
    return globalX(d);
}
function y3(d)
{
    if (globalX(d.driver) < globalX(d))
        return globalY(d);
    return (globalY(d) + globalY(d.driver)) / 2;
}


function updateWires()
{
    d3.selectAll('.wire').selectAll('.wirestart')
        .attr('x1',function(d)
            {
                return d.driver.x + d.driver.parentNode.x;
            })
        .attr('y1',function(d)
            {
                return globalY(d.driver);
            })
        .attr('x2',x2)
        .attr('y2',y2);
    d3.selectAll('.wire').selectAll('.wiremiddle')
        .attr('x1',x2)
        .attr('y1',y2)
        .attr('x2',x3)
        .attr('y2',function(d)
            {
                if (globalX(d.driver) < globalX(d))
                    return globalY(d);
                return (globalY(d) + globalY(d.driver)) / 2;
            });
    d3.selectAll('.wire').selectAll('.wireend')
        .attr('x1',x3)
        .attr('y1',y3)
        .attr('x2',function(d)
            {
                return d.x + d.parentNode.x;
            })
        .attr('y2',function(d)
            {
                return globalY(d);
            });
}


updateWires();
updateNodes();
// size the viewer (assumes there are more cells than in/outputPorts)
d3.select('#viewer')
    .attr('width',VIEWER_WIDTH)
    .attr('height',VIEWER_HEIGHT);


function pullNodeX(otherPort, myPort, pullX, offset)
{
    
    var targetX = offset*(myPort.parentNode.depth - otherPort.parentNode.depth);
    var dx = otherPort.parentNode.x - myPort.parentNode.x - targetX;

    if (myPort.parentNode.fixed!=true){
        myPort.parentNode.x += dx*pullX/2;
    }
    if (otherPort.parentNode.fixed!=true){
        otherPort.parentNode.x -= dx*pullX/2;
    }
}
function pullNodeY(otherPort, myPort, pullY)
{
    var my = globalY(myPort);
    var oy = globalY(otherPort);
    var dy = oy-my;
    if (myPort.parentNode.fixed!=true)
        myPort.parentNode.y += dy*pullY/2;
    if (otherPort.parentNode.fixed!=true)
        otherPort.parentNode.y -= dy*pullY/2;
}

function wirePull(pullX, pullY, offset, alpha)
{
    return function(node){
        node.inputPorts.forEach(function(i)
        {
            pullNodeY(i.driver, i, pullY*alpha);
            pullNodeX(i.driver, i, pullX*alpha, offset);
        });
        node.outputPorts.forEach(function(o)
        {
            o.wire.riders.forEach(function(r)
            {
                pullNodeY(r, o, pullY*alpha);
                pullNodeX(r, o, pullX*alpha, offset);
            });
        });
        if (node.type=='$_dummy_')
        {
            var chain = [node];
            var currNode = node;
            while(currNode.inputPorts[0].driver.parentNode.type=='$_dummy_')
            {
                currNode = currNode.inputPorts[0].driver.parentNode;
                chain.push(currNode);
            }
            var currNode = node;
            while(currNode.outputPorts[0].wire.riders[0].parentNode.type=='$_dummy_')
            {
                currNode = currNode.outputPorts[0].wire.riders[0].parentNode;
                chain.push(currNode);
            }
            var sum = 0;
            chain.forEach(function(n)
            {
                sum += n.y;
            });
            chain.forEach(function(n)
            {
                n.y = sum/chain.length;
            });
        }
    };
}



function getPullX()
{
    var p = document.getElementById('pullX').value;
    d3.select('#pullXSpan').text(p);
    return p;
}

function getPullY()
{
    var p = document.getElementById('pullY').value;
    d3.select('#pullYSpan').text(p);
    return p;
}
function getPullXOffset()
{
    var p = document.getElementById('pullXOffset').value;
    d3.select('#pullXOffsetSpan').text(p);
    return p;
}
function getCharge(d)
{
    var c = document.getElementById('chargeRange').value;
    d3.select('#chargeSpan').text(c);
    return -c;
}

function getGravity()
{
    var g = document.getElementById('gravity').value;
    d3.select('#gravitySpan').text(g);
    return g;
}

function tick(e)
{
    d3.selectAll('.node').each(wirePull(getPullX(), getPullY(), -getPullXOffset(), e.alpha));
    updateNodes();
    updateWires();
}

var force = d3.layout.force()
    .nodes(nodes)
    .size([VIEWER_WIDTH, VIEWER_HEIGHT])
    .gravity(getGravity())
    .charge(getCharge())
    .on('tick',tick);

var drag = force.drag()
    .on("dragstart", dragstart);

force
    .start();

d3.selectAll('.node')
    .call(drag);

d3.selectAll('input').on('change',function()
    {
        force
            .nodes(nodes)
            .gravity(getGravity())
            .charge(getCharge())
            .start();
    });

function releaseNode(n)
{
    n.fixed = false;
    force.resume();
}

function releaseNodes(){
    d3.selectAll('.node')
    .each(releaseNode);
}

//position the ports
d3.selectAll('.port')
    .attr('transform',function(d) { return 'translate('+[d.x, d.y]+')'});

// position the stems
d3.selectAll('.generic').selectAll('.stem')
    .attr({ 'y1' : 0, 'y2' : 0, 'x1':0 });
d3.selectAll('.generic').selectAll('.inport .stem')
    .attr({ 'x2' : STEM_LENGTH });
d3.selectAll('.generic').selectAll('.outport .stem')
    .attr({ 'x2' : -STEM_LENGTH });

d3.selectAll('.dummyBody')
    .attr(
    {
        'x1':(-BODY_WIDTH/2-STEM_LENGTH),
        'x2':(BODY_WIDTH/2+STEM_LENGTH),
        'y1':PORT_GAP/2,
        'y2':PORT_GAP/2
    });

// position generic node bodies
d3.selectAll('.generic .nodeBody')
    .attr('width', BODY_WIDTH)
    .attr('x', -BODY_WIDTH/2)
    .attr('height', function(d,i){return genericHeight(d);});

// position the nodelabel and set it's text
d3.selectAll('.generic.cell .label')
    .text(function(d){return d.depth;})

d3.selectAll('.generic.external .label')
    .text(function(d){return d.depth;})

d3.selectAll('.generic .label')
    .attr('y', NODE_LABEL_Y)
    .attr('x',function(){return -this.getBBox().width/2;})

// position the leaves
d3.selectAll('.leaf')
    .attr('r',LEAF_RADIUS);
